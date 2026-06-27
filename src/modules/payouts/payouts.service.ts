import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import mongoose, { Model, type PipelineStage } from 'mongoose';
import { IPayout } from '../../models/Payout.model';
import { IProduct } from '../../models/Product.model';
import { IOrder } from '../../models/Order.model';
import { IUser, IPayoutMethod } from '../../models/User.model';
import { INotification } from '../../models/Notification.model';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { SavePayoutMethodDto } from './dto/payout-method.dto';
import { EmailService } from '../../services/email.service';

@Injectable()
export class PayoutsService {
  constructor(
    @InjectModel('Payout') private payoutModel: Model<IPayout>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Notification') private notificationModel: Model<INotification>,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Balance (PAY-06 split; PAY-08 exclude refunds; PAY-03 exclude cancelled)
  // ---------------------------------------------------------------------------

  private async computeBalance(sellerId: string) {
    const sellerObjectId = new mongoose.Types.ObjectId(sellerId);
    const products = await this.productModel.find({ seller: sellerObjectId }).select('_id');
    const productIds = products.map(p => p._id);

    const earningsAgg = await this.orderModel.aggregate([
      { $match: { 'items.product': { $in: productIds }, status: 'delivered' } },
      { $unwind: '$items' },
      {
        $match: {
          'items.product': { $in: productIds },
          'items.refundStatus': { $ne: 'completed' },
          'items.returnStatus': { $ne: 'completed' },
        },
      },
      {
        $group: {
          _id: null,
          totalNetEarnings: {
            $sum: { $ifNull: ['$items.sellerEarning', { $multiply: ['$items.price', '$items.quantity'] }] },
          },
        },
      },
    ]);
    const grossEarnings = earningsAgg[0]?.totalNetEarnings ?? 0;

    // PAY-08 (partial refunds): an admin partial refund (and a full refund on a
    // multi-item order) leaves the order status as 'delivered' and only stamps
    // the order-level `refundedAmount`, with no per-item refundStatus. So the
    // earnings aggregation above still counts the full sellerEarning. Subtract
    // the seller's proportional share of each delivered order's refundedAmount
    // so partial refunds actually reduce the withdrawable balance.
    const refundAgg = await this.orderModel.aggregate([
      {
        $match: {
          'items.product': { $in: productIds },
          status: 'delivered',
          refundedAmount: { $gt: 0 },
        },
      },
      // Per-order: seller's net earning in this order, and the order's total
      // earning (all sellers) so we can attribute refundedAmount proportionally.
      { $unwind: '$items' },
      {
        $group: {
          _id: '$_id',
          refundedAmount: { $first: '$refundedAmount' },
          orderTotal: { $first: '$total' },
          sellerEarning: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $in: ['$items.product', productIds] },
                    { $ne: ['$items.refundStatus', 'completed'] },
                    { $ne: ['$items.returnStatus', 'completed'] },
                  ],
                },
                { $ifNull: ['$items.sellerEarning', { $multiply: ['$items.price', '$items.quantity'] }] },
                0,
              ],
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          totalRefundShare: {
            $sum: {
              // Attribute the order's refundedAmount to this seller in proportion
              // to their share of the order total, capped at the seller's earning
              // so a refund never pushes the seller's contribution below zero.
              $min: [
                '$sellerEarning',
                {
                  $cond: [
                    { $gt: ['$orderTotal', 0] },
                    { $multiply: ['$refundedAmount', { $divide: ['$sellerEarning', '$orderTotal'] }] },
                    0,
                  ],
                },
              ],
            },
          },
        },
      },
    ]);
    const totalRefundShare = refundAgg[0]?.totalRefundShare ?? 0;
    const totalEarnings = Math.max(0, grossEarnings - totalRefundShare);

    const payoutAgg = await this.payoutModel.aggregate([
      { $match: { seller: sellerObjectId, status: { $in: ['pending', 'approved', 'paid'] } } },
      { $group: { _id: '$status', total: { $sum: '$amount' } } },
    ]);

    let pendingAmount = 0, approvedAmount = 0, paidAmount = 0;
    for (const row of payoutAgg) {
      if (row._id === 'pending') pendingAmount = row.total;
      else if (row._id === 'approved') approvedAmount = row.total;
      else if (row._id === 'paid') paidAmount = row.total;
    }

    const onHoldAmount = pendingAmount + approvedAmount;
    const availableBalance = Math.max(0, totalEarnings - pendingAmount - approvedAmount - paidAmount);
    return { availableBalance, totalEarnings, totalPaidOut: paidAmount, pendingAmount, approvedAmount, onHoldAmount };
  }

  /** PAY-08: Admin may pass a sellerId to inspect a seller's balance. */
  async getBalance(callerId: string, role: string, sellerId?: string) {
    const targetId = role === 'admin' && sellerId ? sellerId : callerId;
    return { success: true, balance: await this.computeBalance(targetId) };
  }

  // ---------------------------------------------------------------------------
  // Config (PAY-09)
  // ---------------------------------------------------------------------------

  getPayoutConfig() {
    const minimumAmount = this.configService.get<number>('MINIMUM_PAYOUT_AMOUNT') ?? 100;
    const processingFee = this.configService.get<number>('PAYOUT_PROCESSING_FEE') ?? 0;
    const processingDays = this.configService.get<number>('PAYOUT_PROCESSING_DAYS') ?? 3;
    return { success: true, config: { minimumAmount, processingFee, processingDays } };
  }

  // ---------------------------------------------------------------------------
  // Payout Methods (PAY-01)
  // ---------------------------------------------------------------------------

  async getPayoutMethods(sellerId: string) {
    const user = await this.userModel.findById(sellerId).select('payoutMethods');
    return { success: true, payoutMethods: user?.payoutMethods ?? [] };
  }

  async savePayoutMethod(sellerId: string, dto: SavePayoutMethodDto) {
    const user = await this.userModel.findById(sellerId).select('payoutMethods');
    if (!user) throw new NotFoundException('User not found');
    const methods: IPayoutMethod[] = (user.payoutMethods as IPayoutMethod[]) ?? [];
    if (dto.isDefault || methods.length === 0) { for (const m of methods) { m.isDefault = false; } }
    const newMethod = {
      _id: new mongoose.Types.ObjectId(),
      ...dto,
      isDefault: dto.isDefault || methods.length === 0,
    } as IPayoutMethod;
    methods.push(newMethod);
    user.payoutMethods = methods;
    await user.save();
    return { success: true, payoutMethod: newMethod, payoutMethods: user.payoutMethods };
  }

  async updatePayoutMethod(sellerId: string, methodId: string, dto: Partial<SavePayoutMethodDto>) {
    const user = await this.userModel.findById(sellerId).select('payoutMethods');
    if (!user) throw new NotFoundException('User not found');
    const methods = (user.payoutMethods as IPayoutMethod[]) ?? [];
    const idx = methods.findIndex(m => m._id.toString() === methodId);
    if (idx === -1) throw new NotFoundException('Payout method not found');
    if (dto.isDefault) { for (const m of methods) { m.isDefault = false; } }
    methods[idx] = { ...methods[idx], ...dto } as IPayoutMethod;
    user.payoutMethods = methods;
    await user.save();
    return { success: true, payoutMethod: methods[idx], payoutMethods: user.payoutMethods };
  }

  async deletePayoutMethod(sellerId: string, methodId: string) {
    const user = await this.userModel.findById(sellerId).select('payoutMethods');
    if (!user) throw new NotFoundException('User not found');
    const methods = (user.payoutMethods as IPayoutMethod[]) ?? [];
    const idx = methods.findIndex(m => m._id.toString() === methodId);
    if (idx === -1) throw new NotFoundException('Payout method not found');
    const wasDefault = methods[idx].isDefault;
    methods.splice(idx, 1);
    if (wasDefault && methods.length > 0) { methods[0].isDefault = true; }
    user.payoutMethods = methods;
    await user.save();
    return { success: true, payoutMethods: user.payoutMethods };
  }

  // ---------------------------------------------------------------------------
  // Request (PAY-01 payoutMethodId; PAY-09 minimum)
  // ---------------------------------------------------------------------------

  async requestPayout(sellerId: string, dto: RequestPayoutDto) {
    const minimumAmount = this.configService.get<number>('MINIMUM_PAYOUT_AMOUNT') ?? 100;
    if (dto.amount < minimumAmount) {
      throw new BadRequestException(`Minimum payout amount is ${minimumAmount}. Requested: ${dto.amount}`);
    }
    const { availableBalance } = await this.computeBalance(sellerId);
    if (dto.amount > availableBalance) {
      throw new BadRequestException(`Requested amount (${dto.amount}) exceeds available balance (${availableBalance.toFixed(2)})`);
    }
    const existingPending = await this.payoutModel.findOne({ seller: sellerId, status: 'pending' });
    if (existingPending) {
      throw new BadRequestException('You already have a pending payout request. Cancel it or wait for processing before submitting another.');
    }

    let bankDetails: Record<string, unknown> = {
      bankAccountName: dto.bankAccountName,
      bankAccountNumber: dto.bankAccountNumber,
      bankName: dto.bankName,
      ifscCode: dto.ifscCode,
      swiftCode: dto.swiftCode,
      upiId: dto.upiId,
    };

    if (dto.payoutMethodId) {
      const user = await this.userModel.findById(sellerId).select('payoutMethods');
      const method = (user?.payoutMethods as IPayoutMethod[] | undefined)?.find(m => m._id.toString() === dto.payoutMethodId);
      if (!method) throw new BadRequestException('Saved payout method not found');
      bankDetails = {
        bankAccountName: method.bankAccountName,
        bankAccountNumber: method.bankAccountNumber,
        bankName: method.bankName,
        ifscCode: method.ifscCode,
        swiftCode: method.swiftCode,
        upiId: method.upiId,
      };
    } else if (!dto.bankAccountName || !dto.bankAccountNumber || !dto.bankName) {
      throw new BadRequestException('bankAccountName, bankAccountNumber, and bankName are required when payoutMethodId is not provided');
    }

    const payout = await this.payoutModel.create({ seller: sellerId, amount: dto.amount, notes: dto.notes, ...bankDetails });
    return { success: true, payout };
  }

  // ---------------------------------------------------------------------------
  // Cancel (PAY-03)
  // ---------------------------------------------------------------------------

  async cancelPayout(id: string, sellerId: string) {
    const payout = await this.payoutModel.findById(id);
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.seller?.toString() !== sellerId) throw new ForbiddenException('Not authorized to cancel this payout');
    if (payout.status !== 'pending') throw new BadRequestException(`Only pending payouts can be cancelled. Status: '${payout.status}'`);
    payout.status = 'cancelled';
    await payout.save();
    return { success: true, payout };
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  async getPayouts(
    role: string,
    sellerId: string,
    status?: string,
    page = 1,
    limit = 20,
    search?: string,
    from?: string,
    to?: string,
    sort?: string,
  ) {
    const filter: Record<string, unknown> = {};
    if (role !== 'admin') filter.seller = new mongoose.Types.ObjectId(sellerId);
    if (status) filter.status = status;

    // PAY-11: date range filter
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.$lte = toDate;
      }
      filter.createdAt = dateFilter;
    }

    // PAY-11: seller search (admin only — match by name or email)
    let sellerIdFilter: mongoose.Types.ObjectId[] | undefined;
    if (role === 'admin' && search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      const sellers = await this.userModel
        .find({ $or: [{ name: regex }, { email: regex }], role: 'seller' })
        .select('_id')
        .lean();
      sellerIdFilter = sellers.map(s => new mongoose.Types.ObjectId(String(s._id)));
      filter.seller = { $in: sellerIdFilter };
    }

    // PAY-11: sort
    const sortField = sort === 'amount' ? 'amount' : sort === '-amount' ? 'amount' : 'createdAt';
    const sortDir = sort === 'amount' ? 1 : sort === '-amount' ? -1 : -1;
    const sortObj: Record<string, 1 | -1> = { [sortField]: sortDir };

    const skip = (page - 1) * limit;
    const [payouts, total] = await Promise.all([
      this.payoutModel
        .find(filter)
        .populate('seller', 'name email')
        .populate('processedBy', 'name email')
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean(),
      this.payoutModel.countDocuments(filter),
    ]);
    return { success: true, payouts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  // ---------------------------------------------------------------------------
  // Get by ID
  // ---------------------------------------------------------------------------

  async getPayoutById(id: string, sellerId: string, role: string) {
    const payout = await this.payoutModel.findById(id).populate('seller', 'name email').populate('processedBy', 'name email').lean();
    if (!payout) throw new NotFoundException('Payout not found');
    const payoutSellerId = payout.seller && typeof payout.seller === 'object' && '_id' in payout.seller
      ? (payout.seller as any)._id?.toString() : String(payout.seller);
    if (role !== 'admin' && payoutSellerId !== sellerId) throw new ForbiddenException('Not authorized to view this payout');
    return { success: true, payout };
  }

  // ---------------------------------------------------------------------------
  // Admin actions
  // ---------------------------------------------------------------------------

  /** PAY-02: Create an in-app notification for the seller. Fire-and-forget. */
  private async notifySeller(
    sellerId: mongoose.Types.ObjectId | string,
    title: string,
    message: string,
    data: Record<string, unknown>,
  ) {
    try {
      await this.notificationModel.create({ user: sellerId, title, message, type: 'system', data });
    } catch {
      // notification failure must not break the financial action
    }
  }

  /** PAY-02: Try to send a payout status email to the seller. Fire-and-forget. */
  private async emailSeller(sellerId: mongoose.Types.ObjectId | string, subject: string, html: string) {
    try {
      const seller = await this.userModel.findById(sellerId).select('email').lean();
      if (seller?.email) {
        await this.emailService.sendEmail({ to: seller.email, subject, html });
      }
    } catch {
      // email failure must not break the financial action
    }
  }

  private simpleHtml(title: string, body: string): string {
    return `<p><strong>${title}</strong></p><p>${body}</p>`;
  }

  async approvePayout(id: string, adminId: string, adminNotes?: string) {
    const payout = await this.payoutModel.findById(id);
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'pending') throw new BadRequestException(`Cannot approve a payout with status '${payout.status}'`);
    payout.status = 'approved';
    payout.processedBy = adminId as any;
    payout.processedAt = new Date();
    if (adminNotes) payout.adminNotes = adminNotes;
    await payout.save();

    // PAY-02: notify seller
    const msg = `Your payout request of ${payout.currency} ${payout.amount} has been approved and is queued for transfer.`;
    await this.notifySeller(payout.seller, 'Payout Approved', msg, { payoutId: id, status: 'approved' });
    await this.emailSeller(payout.seller, 'Payout Approved', this.simpleHtml('Payout Approved', msg));

    return { success: true, payout };
  }

  async rejectPayout(id: string, adminId: string, rejectionReason: string, adminNotes?: string) {
    const payout = await this.payoutModel.findById(id);
    if (!payout) throw new NotFoundException('Payout not found');
    if (!['pending', 'approved'].includes(payout.status)) throw new BadRequestException(`Cannot reject a payout with status '${payout.status}'`);
    payout.status = 'rejected';
    payout.processedBy = adminId as any;
    payout.processedAt = new Date();
    payout.rejectionReason = rejectionReason;
    if (adminNotes) payout.adminNotes = adminNotes;
    await payout.save();

    // PAY-02: notify seller with rejection reason
    const msg = `Your payout request of ${payout.currency} ${payout.amount} was rejected. Reason: ${rejectionReason}`;
    await this.notifySeller(payout.seller, 'Payout Rejected', msg, { payoutId: id, status: 'rejected', rejectionReason });
    await this.emailSeller(payout.seller, 'Payout Request Rejected', this.simpleHtml('Payout Request Rejected', msg));

    return { success: true, payout };
  }

  async markPaid(
    id: string,
    adminId: string,
    adminNotes?: string,
    transferReference?: string,
    paymentMethod?: string,
    paidAt?: string,
  ) {
    const payout = await this.payoutModel.findById(id);
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'approved') throw new BadRequestException(`Cannot mark as paid a payout with status '${payout.status}'. Approve it first.`);
    payout.status = 'paid';
    payout.processedBy = adminId as any;
    payout.processedAt = new Date();
    if (adminNotes) payout.adminNotes = adminNotes;
    // PAY-05: store transfer traceability fields
    if (transferReference) payout.transferReference = transferReference;
    if (paymentMethod) payout.paymentMethod = paymentMethod;
    if (paidAt) payout.paidAt = new Date(paidAt);
    await payout.save();

    // PAY-02: notify seller with transfer reference
    const refPart = transferReference ? ` Reference: ${transferReference}.` : '';
    const msg = `Your payout of ${payout.currency} ${payout.amount} has been transferred to your account.${refPart}`;
    await this.notifySeller(payout.seller, 'Payout Transferred', msg, {
      payoutId: id,
      status: 'paid',
      transferReference: transferReference ?? null,
    });
    await this.emailSeller(payout.seller, 'Payout Transferred', this.simpleHtml('Payout Transferred', msg));

    return { success: true, payout };
  }

  /** PAY-12: Revert an approved (not-yet-paid) payout back to pending so a mistaken approval can be undone. */
  async revertPayout(id: string, adminId: string, adminNotes?: string) {
    const payout = await this.payoutModel.findById(id);
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'approved') throw new BadRequestException(`Only approved payouts can be reverted to pending. Current status: '${payout.status}'`);
    payout.status = 'pending';
    payout.processedBy = adminId as any;
    payout.processedAt = new Date();
    if (adminNotes) payout.adminNotes = adminNotes;
    await payout.save();
    return { success: true, payout };
  }

  /** PAY-09: Batch approve or mark-paid. Best-effort — collects individual results. */
  async batchProcess(
    ids: string[],
    action: 'approve' | 'mark-paid',
    adminId: string,
    adminNotes?: string,
    transferReference?: string,
    paymentMethod?: string,
  ): Promise<{ success: true; results: Array<{ id: string; ok: boolean; error?: string }> }> {
    const results = await Promise.allSettled(
      ids.map(id =>
        action === 'approve'
          ? this.approvePayout(id, adminId, adminNotes)
          : this.markPaid(id, adminId, adminNotes, transferReference, paymentMethod),
      ),
    );
    return {
      success: true,
      results: results.map((r, i) => ({
        id: ids[i],
        ok: r.status === 'fulfilled',
        error: r.status === 'rejected' ? String((r as PromiseRejectedResult).reason?.message ?? r.reason) : undefined,
      })),
    };
  }

  /** PAY-07: Admin summary — counts and sums grouped by status, plus paid this month. */
  async getSummary() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [statusAgg, paidThisMonthAgg] = await Promise.all([
      this.payoutModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } },
      ]),
      this.payoutModel.aggregate([
        { $match: { status: 'paid', processedAt: { $gte: monthStart } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } },
      ]),
    ]);

    const byStatus: Record<string, { count: number; total: number }> = {};
    for (const row of statusAgg) {
      byStatus[row._id] = { count: row.count, total: row.total };
    }
    const paidThisMonth = paidThisMonthAgg[0] ?? { count: 0, total: 0 };

    return {
      success: true,
      summary: {
        pending: byStatus['pending'] ?? { count: 0, total: 0 },
        approved: byStatus['approved'] ?? { count: 0, total: 0 },
        paid: byStatus['paid'] ?? { count: 0, total: 0 },
        rejected: byStatus['rejected'] ?? { count: 0, total: 0 },
        paidThisMonth: { count: paidThisMonth.count, total: paidThisMonth.total },
      },
    };
  }

  /** PAY-03: Export payouts as a JSON array (the client converts to CSV). */
  async exportPayouts(
    role: string,
    sellerId: string,
    status?: string,
    from?: string,
    to?: string,
  ) {
    const filter: Record<string, unknown> = {};
    if (role !== 'admin') filter.seller = new mongoose.Types.ObjectId(sellerId);
    if (status) filter.status = status;
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to) { const t = new Date(to); t.setHours(23, 59, 59, 999); dateFilter.$lte = t; }
      filter.createdAt = dateFilter;
    }
    const payouts = await this.payoutModel
      .find(filter)
      .populate('seller', 'name email')
      .populate('processedBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    return { success: true, payouts };
  }

  // ---------------------------------------------------------------------------
  // Earnings breakdown (PAY-11)
  // ---------------------------------------------------------------------------

  /**
   * Returns per-delivered-order earnings so sellers can reconcile their
   * available balance to the specific orders that funded it.
   * Admin may pass sellerId to inspect any seller's breakdown.
   */
  async getEarningsBreakdown(
    callerId: string,
    role: string,
    sellerIdParam?: string,
    from?: string,
    to?: string,
    page = 1,
    limit = 50,
  ) {
    const targetSellerId = role === 'admin' && sellerIdParam ? sellerIdParam : callerId;
    const sellerObjectId = new mongoose.Types.ObjectId(targetSellerId);
    const products = await this.productModel.find({ seller: sellerObjectId }).select('_id name').lean();
    const productIds = products.map(p => p._id);
    const productMap = new Map<string, string>(products.map(p => [p._id.toString(), (p as any).name as string]));

    const matchStage: Record<string, unknown> = {
      'items.product': { $in: productIds },
      status: 'delivered',
    };
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.$lte = toDate;
      }
      matchStage.createdAt = dateFilter;
    }

    const pipeline: PipelineStage[] = [
      { $match: matchStage as Record<string, any> },
      { $unwind: '$items' },
      {
        $match: {
          'items.product': { $in: productIds },
          'items.refundStatus': { $ne: 'completed' },
          'items.returnStatus': { $ne: 'completed' },
        },
      },
      {
        $group: {
          _id: '$_id',
          orderNumber: { $first: '$orderNumber' },
          createdAt: { $first: '$createdAt' },
          totalSellerEarning: {
            $sum: { $ifNull: ['$items.sellerEarning', { $multiply: ['$items.price', '$items.quantity'] }] },
          },
          totalCommission: { $sum: { $ifNull: ['$items.commissionAmount', 0] } },
          items: {
            $push: {
              product: '$items.product',
              name: '$items.name',
              quantity: '$items.quantity',
              price: '$items.price',
              sellerEarning: { $ifNull: ['$items.sellerEarning', { $multiply: ['$items.price', '$items.quantity'] }] },
              commissionAmount: { $ifNull: ['$items.commissionAmount', 0] },
            },
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    // Count before pagination
    const countPipeline: PipelineStage[] = [...pipeline, { $count: 'total' } as PipelineStage];
    const countAgg = await this.orderModel.aggregate(countPipeline);
    const total: number = (countAgg[0] as { total: number } | undefined)?.total ?? 0;

    const dataPipeline: PipelineStage[] = [
      ...pipeline,
      { $skip: (page - 1) * limit } as PipelineStage,
      { $limit: limit } as PipelineStage,
    ];
    const dataAgg = await this.orderModel.aggregate(dataPipeline);

    const enriched = dataAgg.map(row => ({
      ...row,
      items: row.items.map((item: any) => ({
        ...item,
        productName: productMap.get(item.product?.toString()) ?? item.name,
      })),
    }));

    return {
      success: true,
      breakdown: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }
}
