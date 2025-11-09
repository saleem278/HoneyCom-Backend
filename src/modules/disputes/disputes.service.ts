import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Dispute, IDispute } from '../../models/Dispute.model';
import { Order, IOrder } from '../../models/Order.model';
import { User, IUser } from '../../models/User.model';
import { Product, IProduct } from '../../models/Product.model';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class DisputesService {
  constructor(
    @InjectModel('Dispute') private disputeModel: Model<IDispute>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    private paymentsService: PaymentsService,
  ) {}

  async create(userId: string, disputeData: any) {
    const order = await this.orderModel.findById(disputeData.orderId).populate('customer');
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Verify user owns the order
    const customerId = typeof order.customer === 'object' && order.customer !== null
      ? (order.customer as any)._id?.toString()
      : order.customer?.toString();
    
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

    return {
      success: true,
      dispute: await this.disputeModel.findById(dispute._id).populate('order customer seller'),
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
    const dispute = await this.disputeModel.findById(id).populate('order');
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    if (dispute.status !== 'open' && dispute.status !== 'in_review') {
      throw new BadRequestException('Dispute cannot be resolved in current status');
    }

    dispute.status = 'resolved';
    dispute.resolution = resolutionData.resolution;
    dispute.resolutionNotes = resolutionData.notes;
    dispute.resolvedBy = adminId as any;
    dispute.resolvedAt = new Date();
    await dispute.save();

    // Process refund if resolution requires it
    if (resolutionData.resolution === 'refund' || resolutionData.resolution === 'partial_refund') {
      const order = dispute.order as any;
      const refundAmount = resolutionData.refundAmount || order.total;
      
      try {
        if (order.paymentIntentId) {
          await this.paymentsService.processRefund(order.paymentIntentId, refundAmount, resolutionData.notes);
        }
        // Update order status
        order.status = 'refunded';
        order.paymentStatus = 'refunded';
        await order.save();
      } catch (error: any) {
        // Error processing refund
        // Continue even if refund fails - admin can process manually
      }
    }

    return {
      success: true,
      message: 'Dispute resolved successfully',
      dispute: await this.disputeModel.findById(dispute._id).populate('order customer seller resolvedBy'),
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

    // Only admin or the customer can close
    if (userRole !== 'admin' && dispute.customer.toString() !== userId) {
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

