import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Dispute, IDispute } from '../../models/Dispute.model';
import { Order, IOrder } from '../../models/Order.model';
import { User, IUser } from '../../models/User.model';
import { Product, IProduct } from '../../models/Product.model';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../../services/email.service';

@Injectable()
export class DisputesService {
  constructor(
    @InjectModel('Dispute') private disputeModel: Model<IDispute>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    private paymentsService: PaymentsService,
    private emailService: EmailService,
  ) {}

  async create(userId: string, disputeData: any) {
    const order = await this.orderModel.findById(disputeData.orderId).populate('customer');
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Verify user owns the order. `customer` is typed as ObjectId, but after
    // `.populate('customer')` it may arrive as a User-like object — handle both.
    const rawCustomer: unknown = order.customer;
    const customerId =
      rawCustomer && typeof rawCustomer === 'object' && '_id' in rawCustomer
        ? String((rawCustomer as { _id: { toString(): string } })._id)
        : String(rawCustomer);
    
    if (customerId !== userId) {
      throw new ForbiddenException('You can only create disputes for your own orders');
    }

    // Check if dispute already exists for this order
    const existingDispute = await this.disputeModel.findOne({ order: disputeData.orderId });
    if (existingDispute) {
      throw new BadRequestException('A dispute already exists for this order');
    }

    // Get seller from order items
    const firstItem = order.items[0];
    if (firstItem && firstItem.product) {
      const product = await this.productModel.findById(firstItem.product);
      if (product && product.seller) {
        disputeData.seller = product.seller;
      }
    }

    const dispute = await this.disputeModel.create({
      order: disputeData.orderId,
      customer: userId,
      seller: disputeData.seller,
      type: disputeData.type,
      reason: disputeData.reason,
      description: disputeData.description,
      attachments: disputeData.attachments || [],
      status: 'open',
    });

    const populated = await this.disputeModel.findById(dispute._id).populate('order customer seller');

    // Notify all parties: customer confirmation, seller + admin alerts. Best-effort.
    setImmediate(async () => {
      try {
        const cust: any = populated?.customer;
        const seller: any = populated?.seller;
        if (cust?.email) {
          await this.emailService.sendDisputeConfirmationEmail(cust.email, populated, order).catch(() => undefined);
        }
        if (seller?.email) {
          await this.emailService
            .sendDisputeAlertEmail({ to: seller.email, dispute: populated, order, portal: 'seller' })
            .catch(() => undefined);
        }
        const admins = await this.userModel.find({ role: 'admin' }).select('email');
        for (const a of admins) {
          if (a.email) {
            await this.emailService
              .sendDisputeAlertEmail({ to: a.email, dispute: populated, order, portal: 'admin' })
              .catch(() => undefined);
          }
        }
      } catch {
        // best-effort notifications
      }
    });

    return {
      success: true,
      dispute: populated,
    };
  }

  async findAll(userId: string, userRole: string, filters?: any) {
    const query: any = {};

    if (userRole === 'customer') {
      query.customer = userId;
    } else if (userRole === 'seller') {
      query.seller = userId;
    }
    // Admin can see all disputes

    if (filters?.status) {
      query.status = filters.status;
    }
    if (filters?.type) {
      query.type = filters.type;
    }

    const disputes = await this.disputeModel
      .find(query)
      .populate('order', 'orderNumber total status')
      .populate('customer', 'name email')
      .populate('seller', 'name email')
      .populate('resolvedBy', 'name email')
      .sort({ createdAt: -1 });

    return {
      success: true,
      disputes,
    };
  }

  async findOne(id: string, userId: string, userRole: string) {
    const dispute = await this.disputeModel
      .findById(id)
      .populate('order')
      .populate('customer', 'name email')
      .populate('seller', 'name email')
      .populate('resolvedBy', 'name email');

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    // Authorization check
    if (userRole !== 'admin') {
      const customerId = dispute.customer.toString();
      const sellerId = dispute.seller?.toString();
      
      if (userRole === 'customer' && customerId !== userId) {
        throw new ForbiddenException('Not authorized');
      }
      if (userRole === 'seller' && sellerId !== userId) {
        throw new ForbiddenException('Not authorized');
      }
    }

    return {
      success: true,
      dispute,
    };
  }

  async resolve(id: string, adminId: string, resolutionData: any) {
    // Atomically claim the dispute — only succeeds if it's still open/in_review.
    // This prevents two concurrent admin requests from both processing a refund
    // (double-refund race condition). The $set is committed before the refund
    // call, so a second request will hit the 'already resolved' guard below.
    const disputed = await this.disputeModel.findOneAndUpdate(
      { _id: id, status: { $in: ['open', 'in_review'] } },
      { $set: { status: 'resolving', resolvedBy: adminId, resolvedAt: new Date() } },
      { new: false }, // Return the OLD document so we can detect concurrent resolve
    ).populate('order');

    if (!disputed) {
      // Either not found, or already being/been resolved by a concurrent request.
      const existing = await this.disputeModel.findById(id);
      if (!existing) throw new NotFoundException('Dispute not found');
      throw new BadRequestException(
        `Dispute cannot be resolved in current status (${existing.status}). It may have already been resolved.`,
      );
    }

    // Process refund if resolution requires it. Any failure here rolls the
    // dispute back to 'in_review' so the admin can retry.
    if (resolutionData.resolution === 'refund' || resolutionData.resolution === 'partial_refund') {
      const order = disputed.order as any;
      const refundAmount = resolutionData.refundAmount || order.total;

      // Validate refund amount does not exceed original order total
      if (refundAmount > order.total) {
        await this.disputeModel.findByIdAndUpdate(id, { $set: { status: 'in_review' } });
        throw new BadRequestException(
          `Refund amount (${refundAmount}) cannot exceed order total (${order.total})`,
        );
      }

      const razorpayPaymentId = (order as any).razorpayPaymentId;
      if (razorpayPaymentId) {
        try {
          await this.paymentsService.processRefund(razorpayPaymentId, refundAmount, resolutionData.notes);
        } catch (error: any) {
          // Roll back the status claim so admin can retry
          await this.disputeModel.findByIdAndUpdate(id, { $set: { status: 'in_review' } });
          throw new BadRequestException(`Razorpay refund failed: ${error.message || error}. Dispute status reset to in_review.`);
        }
      }

      // Mark order as refunded only after successful payment processing
      order.status = 'refunded';
      order.paymentStatus = 'refunded';
      await order.save();
    }

    // Finalize the dispute
    await this.disputeModel.findByIdAndUpdate(id, {
      $set: {
        status: 'resolved',
        resolution: resolutionData.resolution,
        resolutionNotes: resolutionData.notes,
      },
    });

    const resolved = await this.disputeModel.findById(id).populate('order customer seller resolvedBy');

    // Notify the customer and seller of the resolution. Best-effort.
    setImmediate(async () => {
      try {
        const ord: any = resolved?.order;
        const cust: any = resolved?.customer;
        const seller: any = resolved?.seller;
        if (cust?.email) {
          await this.emailService
            .sendDisputeResolvedEmail({ to: cust.email, dispute: resolved, order: ord, portal: 'customer' })
            .catch(() => undefined);
        }
        if (seller?.email) {
          await this.emailService
            .sendDisputeResolvedEmail({ to: seller.email, dispute: resolved, order: ord, portal: 'seller' })
            .catch(() => undefined);
        }
      } catch {
        // best-effort notifications
      }
    });

    return {
      success: true,
      message: 'Dispute resolved successfully',
      dispute: resolved,
    };
  }

  async updateStatus(id: string, userId: string, userRole: string, status: string) {
    const dispute = await this.disputeModel.findById(id);
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    // Only admin can change status
    if (userRole !== 'admin') {
      throw new ForbiddenException('Only admins can update dispute status');
    }

    dispute.status = status as any;
    await dispute.save();

    return {
      success: true,
      dispute: await this.disputeModel.findById(dispute._id).populate('order customer seller'),
    };
  }

  async close(id: string, userId: string, userRole: string) {
    const dispute = await this.disputeModel.findById(id);
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    // Only admin or the customer who raised the dispute can close it.
    // Sellers are explicitly excluded even if their userId somehow matched the
    // customer field (defense-in-depth).
    if (userRole === 'seller' || (userRole !== 'admin' && dispute.customer.toString() !== userId)) {
      throw new ForbiddenException('Not authorized to close this dispute');
    }

    if (dispute.status !== 'resolved') {
      throw new BadRequestException('Only resolved disputes can be closed');
    }

    dispute.status = 'closed';
    await dispute.save();

    return {
      success: true,
      dispute: await this.disputeModel.findById(dispute._id).populate('order customer seller'),
    };
  }
}

