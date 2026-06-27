import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Dispute, IDispute } from '../../models/Dispute.model';
import { Order, IOrder } from '../../models/Order.model';
import { User, IUser } from '../../models/User.model';
import { Product, IProduct } from '../../models/Product.model';
import { INotification } from '../../models/Notification.model';
import { PaymentsService } from '../payments/payments.service';
import { OrdersService } from '../orders/orders.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { EmailService } from '../../services/email.service';

@Injectable()
export class DisputesService {
  constructor(
    @InjectModel('Dispute') private disputeModel: Model<IDispute>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Notification') private notificationModel: Model<INotification>,
    private paymentsService: PaymentsService,
    private ordersService: OrdersService,
    private emailService: EmailService,
  ) {}

  /**
   * Escape a user-supplied string so it's safe to embed in a RegExp.
   * Prevents ReDoS (e.g. "(a+)+") and regex-metacharacter breakage.
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Fire-and-forget in-app notifications for a dispute event. Creates a
   * Notification row for the seller (when known) and for every admin/superadmin,
   * mirroring the email recipients so disputes surface in the recipient's bell
   * independent of email (phone-only sellers, admins who only watch the portal).
   * Notification failures must never break the dispute flow.
   */
  private async notifyDisputeParties(params: {
    sellerId?: string | null;
    orderId?: string | null;
    orderNumber?: string | null;
    disputeId: string;
    title: string;
    message: string;
  }): Promise<void> {
    try {
      const data = {
        disputeId: params.disputeId,
        orderId: params.orderId ?? undefined,
        orderNumber: params.orderNumber ?? undefined,
        kind: 'dispute',
      };
      const rows: any[] = [];
      if (params.sellerId) {
        rows.push({
          user: params.sellerId,
          title: params.title,
          message: params.message,
          type: 'system',
          data,
        });
      }
      const admins = await this.userModel
        .find({ role: { $in: ['admin', 'superadmin'] } })
        .select('_id')
        .lean();
      for (const a of admins) {
        rows.push({
          user: (a as any)._id,
          title: params.title,
          message: params.message,
          type: 'system',
          data,
        });
      }
      if (rows.length) {
        await this.notificationModel.insertMany(rows);
      }
    } catch {
      // notification failure must not break the dispute flow
    }
  }

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

    // Resolve the seller from the SPECIFIC item being disputed. Always taking
    // items[0] mis-assigns the dispute (and refund/notifications) to the wrong
    // seller on a multi-seller order. The client identifies the disputed line
    // via productId (preferred) or itemId; we fall back to items[0] only for a
    // single-seller order where there is no ambiguity.
    const items = (order.items as any[]) || [];
    const disputedProductId = disputeData.productId ?? disputeData.product;
    const disputedItemId = disputeData.itemId;

    let disputedItem: any = null;
    if (disputedProductId) {
      disputedItem = items.find((it: any) => {
        const pid = it.product?._id?.toString?.() ?? it.product?.toString?.();
        return pid && pid === String(disputedProductId);
      });
      if (!disputedItem) {
        throw new BadRequestException('The disputed product is not part of this order');
      }
    } else if (disputedItemId) {
      disputedItem = items.find((it: any) => it._id?.toString?.() === String(disputedItemId));
      if (!disputedItem) {
        throw new BadRequestException('The disputed item is not part of this order');
      }
    } else {
      // No product identified. Only safe to auto-resolve the seller when the
      // order has a single seller; otherwise require the client to specify one.
      const sellerIds = new Set(
        items
          .map((it: any) => (it.seller ? it.seller.toString() : null))
          .filter((s: string | null): s is string => !!s),
      );
      if (sellerIds.size > 1) {
        throw new BadRequestException(
          'This order has items from multiple sellers — specify productId to identify the disputed item',
        );
      }
      disputedItem = items[0] ?? null;
    }

    if (disputedItem) {
      // Prefer the seller snapshotted on the line item; fall back to a Product
      // lookup for legacy rows that predate the item.seller snapshot.
      if (disputedItem.seller) {
        disputeData.seller = disputedItem.seller;
      } else if (disputedItem.product) {
        const product = await this.productModel.findById(
          disputedItem.product?._id ?? disputedItem.product,
        );
        if (product && product.seller) {
          disputeData.seller = product.seller;
        }
      }
    }

    // SLA target: first response/resolution due 48h after the dispute opens.
    const slaDueAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const dispute = await this.disputeModel.create({
      order: disputeData.orderId,
      customer: userId,
      seller: disputeData.seller,
      type: disputeData.type,
      reason: disputeData.reason,
      description: disputeData.description,
      attachments: disputeData.attachments || [],
      status: 'open',
      slaDueAt,
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
      // In-app notifications for seller + admins (mirrors the email recipients;
      // also reaches phone-only sellers and admins who only watch the portal).
      const sellerObj: any = populated?.seller;
      const sellerId = sellerObj?._id?.toString?.() ?? (disputeData.seller ? String(disputeData.seller) : null);
      await this.notifyDisputeParties({
        sellerId,
        orderId: String((order as any)._id),
        orderNumber: (order as any).orderNumber ?? null,
        disputeId: String(dispute._id),
        title: 'New Dispute Opened',
        message: `A dispute was opened on order ${(order as any).orderNumber ?? ''}.`.trim(),
      });
    });

    return {
      success: true,
      dispute: populated,
    };
  }

  async findAll(userId: string, userRole: string, filters?: any) {
    const page = parseInt(filters?.page || '1', 10) || 1;
    const limit = parseInt(filters?.limit || '20', 10) || 20;
    const safeLimit = Math.min(limit, 100);
    const skip = (page - 1) * safeLimit;

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
    if (filters?.search?.trim()) {
      // Escape + length-cap the user input before building the RegExp (ReDoS /
      // metacharacter safety).
      const safe = DisputesService.escapeRegex(String(filters.search).trim().slice(0, 200));
      const rx = new RegExp(safe, 'i');
      // Dispute has no `orderNumber` field — it stores `order` as an ObjectId
      // ref. Resolve matching order ids first, then search by `order` + the
      // dispute's own `description` text.
      const orderIds = await this.orderModel
        .find({ orderNumber: rx })
        .select('_id')
        .lean()
        .then((docs) => docs.map((d) => d._id));
      query.$or = [{ order: { $in: orderIds } }, { description: rx }];
    }

    const [disputes, total] = await Promise.all([
      this.disputeModel
        .find(query)
        .populate('order', 'orderNumber total status paymentMethod razorpayPaymentId')
        .populate('customer', 'name email')
        .populate('seller', 'name email')
        .populate('resolvedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      this.disputeModel.countDocuments(query),
    ]);

    return {
      success: true,
      disputes,
      pagination: {
        page,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
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

  async resolve(id: string, adminId: string, resolutionData: ResolveDisputeDto) {
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
      const orderTotal = Number(order?.total) || 0;

      // Short-circuit if the order has already been refunded — never re-refund.
      if (order?.paymentStatus === 'refunded') {
        await this.disputeModel.findByIdAndUpdate(id, { $set: { status: 'in_review' } });
        throw new BadRequestException('This order has already been refunded.');
      }

      // Lower-bound / NaN / upper-bound guards. The DTO already enforces
      // refundAmount >= 0.01 when present; here we additionally require a
      // positive, finite amount within the order total and require an explicit
      // amount for a partial refund.
      let refundAmount: number | undefined = resolutionData.refundAmount;
      if (resolutionData.resolution === 'partial_refund') {
        if (refundAmount === undefined || refundAmount === null) {
          await this.disputeModel.findByIdAndUpdate(id, { $set: { status: 'in_review' } });
          throw new BadRequestException('refundAmount is required for a partial refund');
        }
      }
      if (refundAmount !== undefined && refundAmount !== null) {
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
          await this.disputeModel.findByIdAndUpdate(id, { $set: { status: 'in_review' } });
          throw new BadRequestException('refundAmount must be a positive number');
        }
        if (refundAmount > orderTotal) {
          await this.disputeModel.findByIdAndUpdate(id, { $set: { status: 'in_review' } });
          throw new BadRequestException(
            `Refund amount (${refundAmount}) cannot exceed order total (${orderTotal})`,
          );
        }
      }

      // Route the money + refundedAmount bookkeeping + order state machine
      // through the single shared refund method on OrdersService. It reads
      // refundedAmount, clamps to the remaining balance, increments
      // refundedAmount, and only flips status/paymentStatus to 'refunded' once
      // fully refunded — closing the double-refund hole and the
      // state-machine-bypass. A full refund passes undefined to refund the
      // remaining balance.
      try {
        // For a full refund refundAmount is undefined → refunds the remaining
        // balance; for a partial refund it's the validated explicit amount.
        await this.ordersService.refundOrderForDispute(
          String(order._id),
          refundAmount,
          resolutionData.notes || 'Dispute resolution refund',
        );
      } catch (error: any) {
        // Roll back the status claim so admin can retry.
        await this.disputeModel.findByIdAndUpdate(id, { $set: { status: 'in_review' } });
        throw new BadRequestException(
          `Refund failed: ${error?.message || error}. Dispute status reset to in_review.`,
        );
      }
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
      // In-app notifications for seller + admins of the resolution.
      const ord: any = resolved?.order;
      const seller: any = resolved?.seller;
      await this.notifyDisputeParties({
        sellerId: seller?._id?.toString?.() ?? null,
        orderId: ord?._id ? String(ord._id) : null,
        orderNumber: ord?.orderNumber ?? null,
        disputeId: String(id),
        title: 'Dispute Resolved',
        message: `Dispute on order ${ord?.orderNumber ?? ''} was resolved (${resolutionData.resolution}).`.trim(),
      });
    });

    return {
      success: true,
      message: 'Dispute resolved successfully',
      dispute: resolved,
    };
  }

  // Allowed dispute status transitions. Out-of-order moves (e.g. closed → open,
  // or jumping straight to closed without resolving) are rejected so the UI
  // can't drive the dispute into an inconsistent state. Note: 'refund' money
  // movement must go through resolve(); this map only governs status-only edits.
  private static readonly ALLOWED_DISPUTE_TRANSITIONS: Record<string, string[]> = {
    open: ['in_review', 'rejected', 'resolved'],
    in_review: ['resolved', 'rejected', 'closed'],
    resolved: ['closed'],
    rejected: [],
    closed: [],
  };

  async updateStatus(id: string, userId: string, userRole: string, status: string) {
    const dispute = await this.disputeModel.findById(id);
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    // Only admin can change status
    if (userRole !== 'admin') {
      throw new ForbiddenException('Only admins can update dispute status');
    }

    const current = dispute.status;
    // No-op updates to the same status are allowed; otherwise enforce the
    // state machine so transitions can't be applied out of order.
    if (status !== current) {
      const allowed = DisputesService.ALLOWED_DISPUTE_TRANSITIONS[current] ?? [];
      if (!allowed.includes(status)) {
        throw new BadRequestException(
          `Cannot change dispute status from "${current}" to "${status}".`,
        );
      }
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

  /**
   * Append a message to the dispute thread. Customer/seller/admin can all post,
   * but only parties to the dispute, and customers can never post internal notes.
   * Posting on an 'open' dispute moves it to 'in_review' (first response).
   */
  async addMessage(
    id: string,
    userId: string,
    userRole: string,
    body: { body: string; attachments?: string[]; internal?: boolean },
  ) {
    if (!body?.body?.trim()) {
      throw new BadRequestException('Message body is required');
    }

    const dispute = await this.disputeModel.findById(id);
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    // Only parties to the dispute may post.
    if (userRole === 'customer' && dispute.customer.toString() !== userId) {
      throw new ForbiddenException('Not authorized');
    }
    if (userRole === 'seller' && dispute.seller?.toString() !== userId) {
      throw new ForbiddenException('Not authorized');
    }

    // Customers can never post internal (staff-only) notes.
    const internal = userRole === 'customer' ? false : !!body.internal;

    dispute.messages.push({
      author: userId as any,
      authorRole: userRole as 'admin' | 'seller' | 'customer',
      body: body.body.trim(),
      attachments: body.attachments || [],
      internal,
      createdAt: new Date(),
    });

    // A reply on a brand-new dispute advances it to in_review.
    if (dispute.status === 'open' && !internal) {
      dispute.status = 'in_review';
    }
    await dispute.save();

    const populated = await this.disputeModel
      .findById(id)
      .populate('order', 'orderNumber total status')
      .populate('customer', 'name email')
      .populate('seller', 'name email')
      .populate('messages.author', 'name email role');

    return { success: true, dispute: populated };
  }

  /**
   * Reject/deny a dispute with a mandatory reason (admin only). Records the
   * reason as the resolution note and notifies the customer.
   */
  async reject(id: string, adminId: string, reason: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    const dispute = await this.disputeModel.findById(id);
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }
    if (!['open', 'in_review'].includes(dispute.status)) {
      throw new BadRequestException(
        `Dispute cannot be rejected in its current status (${dispute.status}).`,
      );
    }

    dispute.status = 'rejected';
    dispute.resolution = 'no_action';
    dispute.resolutionNotes = reason.trim();
    dispute.resolvedBy = adminId as any;
    dispute.resolvedAt = new Date();
    await dispute.save();

    const populated = await this.disputeModel
      .findById(id)
      .populate('order customer seller resolvedBy');

    // Notify the customer of the rejection. Best-effort.
    setImmediate(async () => {
      try {
        const cust: any = populated?.customer;
        const ord: any = populated?.order;
        if (cust?.email) {
          await this.emailService
            .sendDisputeResolvedEmail({ to: cust.email, dispute: populated, order: ord, portal: 'customer' })
            .catch(() => undefined);
        }
      } catch {
        // best-effort
      }
      // In-app notifications for seller + admins of the rejection.
      const ord: any = populated?.order;
      const seller: any = populated?.seller;
      await this.notifyDisputeParties({
        sellerId: seller?._id?.toString?.() ?? (seller ? String(seller) : null),
        orderId: ord?._id ? String(ord._id) : null,
        orderNumber: ord?.orderNumber ?? null,
        disputeId: String(id),
        title: 'Dispute Rejected',
        message: `Dispute on order ${ord?.orderNumber ?? ''} was rejected.`.trim(),
      });
    });

    return { success: true, message: 'Dispute rejected', dispute: populated };
  }
}

