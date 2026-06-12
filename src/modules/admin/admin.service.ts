import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { User, IUser } from '../../models/User.model';
import { Product, IProduct } from '../../models/Product.model';
import { Order, IOrder } from '../../models/Order.model';
import { Category, ICategory } from '../../models/Category.model';
import {
  ImpersonationEvent,
  IImpersonationEvent,
} from '../../models/ImpersonationEvent.model';
import { INotification } from '../../models/Notification.model';
import { IBroadcast } from '../../models/Broadcast.model';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../../services/email.service';
import { ExchangeRateService, Currency } from '../../services/exchange-rate.service';
import { AuthService } from '../auth/auth.service';
import { assertOrderTransition } from '../orders/order-status';
import { IStore } from '../../models/Store.model';
import { LoyaltyService } from '../loyalty/loyalty.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('Category') private categoryModel: Model<ICategory>,
    @InjectModel('ImpersonationEvent') private impersonationModel: Model<IImpersonationEvent>,
    @InjectModel('Notification') private notificationModel: Model<INotification>,
    @InjectModel('Broadcast') private broadcastModel: Model<IBroadcast>,
    private notificationScheduler: NotificationSchedulerService,
    private paymentsService: PaymentsService,
    private emailService: EmailService,
    private jwtService: JwtService,
    private authService: AuthService,
    private exchangeRateService: ExchangeRateService,
    @InjectModel('Store') private storeModel: Model<IStore>,
    @Optional() private readonly loyaltyService?: LoyaltyService,
  ) {}

  private convertOrderCurrency(order: any): any {
    if (!order) return order;
    const orderObj = typeof order.toObject === 'function' ? order.toObject() : order;
    const rate = orderObj.exchangeRate || 1.0;
    orderObj.subtotal = Number((orderObj.subtotal * rate).toFixed(2));
    orderObj.tax = Number((orderObj.tax * rate).toFixed(2));
    orderObj.shipping = Number((orderObj.shipping * rate).toFixed(2));
    orderObj.discount = Number((orderObj.discount * rate).toFixed(2));
    orderObj.total = Number((orderObj.total * rate).toFixed(2));
    if (orderObj.items) {
      orderObj.items = orderObj.items.map((item: any) => {
        const itemObj = { ...item };
        itemObj.price = Number((itemObj.price * rate).toFixed(2));
        return itemObj;
      });
    }
    return orderObj;
  }

  /**
   * Mint an impersonation session. Returns a JWT carrying the target
   * user's id (so downstream APIs scope by that user) plus the
   * admin's id under `impersonator` (so audit code can attribute the
   * action to the real actor).
   *
   * Refuses to impersonate another admin — there's no support reason
   * for it, and it would create an audit ambiguity worth avoiding.
   * Forces a short expiry (1h) and a required reason string so the
   * audit log has actual signal.
   */
  async startImpersonation(
    adminId: string,
    targetUserId: string,
    reason: string,
    ip?: string,
    userAgent?: string,
  ) {
    if (adminId === targetUserId) {
      throw new BadRequestException('Cannot impersonate yourself');
    }

    const trimmedReason = (reason || '').trim();
    if (trimmedReason.length < 5) {
      throw new BadRequestException(
        'A reason of at least 5 characters is required to impersonate a user',
      );
    }

    const target = await this.userModel.findById(targetUserId).select('_id role name email');
    if (!target) {
      throw new NotFoundException('Target user not found');
    }

    if (target.role === 'admin') {
      throw new ForbiddenException('Cannot impersonate another admin');
    }

    // Audit log row first so a failed JWT mint can't leave a session
    // un-recorded. The endedAt is set when the admin explicitly ends
    // the session via /admin/impersonate/end; sessions whose tokens
    // expire silently leave endedAt unset (with the token's own exp
    // serving as the implicit upper bound).
    const event = await this.impersonationModel.create({
      impersonator: adminId,
      target: target._id,
      startedAt: new Date(),
      ip,
      userAgent,
      reason: trimmedReason,
    });

    // 1h expiry. Long enough for genuine support work, short enough
    // that a leaked token has limited blast radius.
    //
    // `purpose: 'impersonation'` is required by JwtStrategy to accept
    // this token. Previously the token was signed without a purpose
    // claim AND without a Session row — strategy rejected it, so
    // impersonation was actually broken once strict checks landed.
    // Now we mint the token AND record a Session row tagged with
    // purpose='impersonation' + impersonator=adminId, so the strategy
    // accepts it via the same path as a normal login.
    const token = this.jwtService.sign(
      {
        id: target._id.toString(),
        impersonator: adminId,
        eventId: event._id.toString(),
        purpose: 'impersonation',
      },
      { expiresIn: '1h' },
    );

    // Session row: 1h expiry to match the JWT; deviceInfo+ip lifted
    // from the request so the audit page shows where the impersonation
    // originated.
    const sessionExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.authService.createSession(
      target._id as mongoose.Types.ObjectId,
      token,
      userAgent ? { userAgent } : undefined,
      ip,
      sessionExpiresAt,
      'impersonation',
      new mongoose.Types.ObjectId(adminId),
    );

    return {
      success: true,
      token,
      target: {
        id: target._id,
        role: target.role,
        name: target.name,
        email: target.email,
      },
      event: {
        id: event._id,
        startedAt: event.startedAt,
      },
    };
  }

  /**
   * End an active impersonation session. The frontend just discards
   * the impersonation token and reverts to the admin's original
   * session token (which it kept locally), so this endpoint exists
   * primarily to close the audit row's `endedAt`.
   */
  async endImpersonation(eventId: string, callerImpersonatorId: string) {
    const event = await this.impersonationModel.findById(eventId);
    if (!event) {
      throw new NotFoundException('Impersonation session not found');
    }
    // Only the admin who started it can end it via this endpoint.
    // Anyone else hitting this path with a stolen eventId would just
    // bump someone else's audit row, which we want to refuse.
    if (event.impersonator.toString() !== callerImpersonatorId) {
      throw new ForbiddenException('You did not start this impersonation session');
    }
    if (event.endedAt) {
      // Idempotent — return the existing record rather than failing.
      return { success: true, event };
    }
    event.endedAt = new Date();
    await event.save();
    return { success: true, event };
  }

  /**
   * Recent impersonation activity. Both directions: admins by default
   * see their own sessions; pass viewAll=true (admin-only at the
   * controller level) to see everyone's. Used by the audit screen.
   */
  async listImpersonations(adminId: string, viewAll = false, limit = 50) {
    const filter: any = viewAll ? {} : { impersonator: adminId };
    const events = await this.impersonationModel
      .find(filter)
      .sort({ startedAt: -1 })
      .limit(Math.min(limit, 200))
      .populate('impersonator', 'name email role')
      .populate('target', 'name email role');
    return { success: true, events };
  }

  async getDashboard(currency: string = 'INR') {
    const rate = this.exchangeRateService.getExchangeRate(currency.toUpperCase() as Currency);
    const totalUsers = await this.userModel.countDocuments();
    const totalSellers = await this.userModel.countDocuments({ role: 'seller' });
    const totalProducts = await this.productModel.countDocuments();
    const totalOrders = await this.orderModel.countDocuments();

    // Count pending sellers
    const pendingSellers = await this.userModel.countDocuments({
      role: 'seller',
      'sellerInfo.approvalStatus': 'pending',
    });

    // Count pending products
    const pendingProducts = await this.productModel.countDocuments({
      status: 'pending',
    });

    // Calculate total revenue (all time, delivered orders only)
    const totalRevenue = await this.orderModel.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);

    // Calculate monthly revenue (current calendar month) and previous month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(startOfMonth.getTime() - 1);

    const monthlyRevenue = await this.orderModel.aggregate([
      { $match: { status: 'delivered', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]);

    const prevMonthRevenue = await this.orderModel.aggregate([
      { $match: { status: 'delivered', createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth } } },
      { $group: { _id: null, total: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]);

    // Previous-month user and product counts for trend deltas
    const prevMonthUsers = await this.userModel.countDocuments({
      createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
    });
    const currMonthUsers = await this.userModel.countDocuments({
      createdAt: { $gte: startOfMonth },
    });
    const prevMonthProducts = await this.productModel.countDocuments({
      createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
    });
    const currMonthProducts = await this.productModel.countDocuments({
      createdAt: { $gte: startOfMonth },
    });
    const prevMonthOrders = await this.orderModel.countDocuments({
      createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
    });
    const currMonthOrders = await this.orderModel.countDocuments({
      createdAt: { $gte: startOfMonth },
    });

    // Get recent orders (last 5, any status so admins see new pending orders)
    const recentOrders = await this.orderModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('customer', 'name email')
      .select('orderNumber customer total status createdAt paymentStatus')
      .lean();

    // Get top products (by sales/revenue)
    const topProducts = await this.orderModel.aggregate([
      { $match: { status: 'delivered' } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $group: {
          _id: '$product._id',
          name: { $first: '$product.name' },
          image: { $first: '$product.images' },
          totalSold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]);

    // Convert recent orders to requested currency
    const convertedRecentOrders = recentOrders.map((order: any) => {
      const orderCopy = { ...order, exchangeRate: rate };
      return this.convertOrderCurrency(orderCopy);
    });

    // Helper to compute % change
    const pctChange = (curr: number, prev: number): number | null => {
      if (prev === 0) return null;
      return Number(((curr - prev) / prev * 100).toFixed(1));
    };

    const currMonthRev = (monthlyRevenue[0]?.total || 0) * rate;
    const prevMonthRev = (prevMonthRevenue[0]?.total || 0) * rate;

    return {
      success: true,
      dashboard: {
        totalUsers,
        totalSellers,
        totalProducts,
        totalOrders,
        pendingSellers,
        pendingProducts,
        totalRevenue: Number(((totalRevenue[0]?.total || 0) * rate).toFixed(2)),
        monthlyRevenue: Number(currMonthRev.toFixed(2)),
        // Period-over-period trend deltas (current month vs previous month)
        trends: {
          revenue: pctChange(currMonthRev, prevMonthRev),
          orders: pctChange(currMonthOrders, prevMonthOrders),
          users: pctChange(currMonthUsers, prevMonthUsers),
          products: pctChange(currMonthProducts, prevMonthProducts),
        },
        recentOrders: convertedRecentOrders.map((order: any) => ({
          _id: order._id,
          orderNumber: order.orderNumber,
          customer: order.customer,
          total: order.total,
          status: order.status,
          createdAt: order.createdAt,
        })),
        topProducts: topProducts.map((product: any) => ({
          _id: product._id,
          name: product.name,
          image: Array.isArray(product.image) ? product.image[0] : product.image,
          totalSold: product.totalSold,
          revenue: Number((product.revenue * rate).toFixed(2)),
        })),
      },
    };
  }

  async getUsers(
    page: number = 1,
    limit: number = 20,
    search?: string,
    role?: string,
    status?: string,
    sort?: string,
  ) {
    const skip = (page - 1) * limit;
    const filter: Record<string, any> = {};

    if (search?.trim()) {
      const rx = new RegExp(search.trim(), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }
    if (role && role !== 'all') filter.role = role;
    if (status && status !== 'all') filter.status = status;

    const sortField: Record<string, any> =
      sort === 'name' ? { name: 1 } : sort === 'email' ? { email: 1 } : { createdAt: -1 };

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('-password')
        .sort(sortField)
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

    return {
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async approveProduct(productId: string) {
    // Clear any prior rejectionReason on approval — the product is live now.
    const product = await this.productModel.findByIdAndUpdate(
      productId,
      { status: 'approved', $unset: { rejectionReason: '' } },
      { new: true },
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Notify the seller. We don't fail the approval if email fails.
    const seller = await this.userModel.findById(product.seller).select('email');
    if (seller?.email) {
      try {
        await this.emailService.sendProductApprovalEmail(seller.email, product.name);
      } catch {
        // Approval state is the source of truth; email is best-effort.
      }
    }

    return {
      success: true,
      product,
    };
  }

  async rejectProduct(productId: string, reason?: string) {
    // Persist the reason on the product so the seller can see *why* later, not
    // only when the email arrives.
    const product = await this.productModel.findByIdAndUpdate(
      productId,
      { status: 'rejected', rejectionReason: reason },
      { new: true },
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const seller = await this.userModel.findById(product.seller).select('email');
    if (seller?.email) {
      try {
        await this.emailService.sendProductRejectionEmail(seller.email, product.name, reason);
      } catch {
        // Rejection state is already saved; email is best-effort.
      }
    }

    return {
      success: true,
      product,
      reason,
    };
  }

  async updateUserStatus(userId: string, status: 'active' | 'inactive' | 'suspended') {
    if (!['active', 'inactive', 'suspended'].includes(status)) {
      throw new BadRequestException('Invalid status. Must be "active", "inactive", or "suspended"');
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Prevent suspending admin users
    if (user.role === 'admin' && status === 'suspended') {
      throw new BadRequestException('Admin users cannot be suspended');
    }

    user.status = status;
    await user.save();

    // SS-9: cascade seller store to inactive when seller is suspended or inactive
    if (user.role === 'seller' && (status === 'suspended' || status === 'inactive')) {
      await this.storeModel.updateMany({ seller: user._id }, { status: 'inactive' });
    }

    // Notify the user their account status changed. Best-effort.
    if (user.email) {
      this.emailService
        .sendAccountStatusEmail(user.email, status, user.name || 'there')
        .catch((err: any) => this.logger.warn(`Account status email failed for ${user.email}: ${err?.message || err}`));
    }

    return {
      success: true,
      user,
    };
  }

  async processRefund(orderId: string, amount?: number, reason?: string) {
    const order = await this.orderModel.findById(orderId).populate('customer');
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Validate the transition (also rejects refund-of-already-refunded etc.).
    assertOrderTransition(order.status, 'refunded');

    const refundAmount = amount || order.total;

    if (refundAmount > order.total) {
      throw new BadRequestException('Refund amount cannot exceed order total');
    }

    // Razorpay MUST succeed before we mark the order refunded.
    // For razorpayPaymentId-less orders (cash-on-delivery, manual
    // settlement) we skip the gateway leg but still flip status.
    const razorpayPaymentId = (order as any).razorpayPaymentId;
    if (razorpayPaymentId) {
      try {
        await this.paymentsService.processRefund(razorpayPaymentId, refundAmount, reason);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Payment gateway refund failed';
        this.logger.error(
          `Refund failed for order ${order._id} (razorpayPaymentId=${razorpayPaymentId}): ${message}`,
        );
        throw new BadRequestException(`Refund failed: ${message}`);
      }
    }

    // Gateway refund succeeded (or wasn't applicable) — safe to mark
    // the order refunded.
    order.status = 'refunded';
    order.paymentStatus = 'refunded';
    await order.save();

    // Notify the customer their refund was processed. Best-effort.
    const refundCustomerEmail = (order as any)?.customer?.email;
    if (refundCustomerEmail) {
      this.emailService
        .sendOrderRefundedEmail(refundCustomerEmail, order, refundAmount, reason)
        .catch((err: any) => this.logger.warn(`Refund email failed for order ${order._id}: ${err?.message || err}`));
    }

    return {
      success: true,
      message: 'Refund processed successfully',
      refund: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        amount: refundAmount,
        reason: reason || 'Administrative refund',
        processedAt: new Date(),
      },
      order,
    };
  }

  async getPendingSellers() {
    const sellers = await this.userModel
      .find({ role: 'seller', 'sellerInfo.approvalStatus': 'pending' })
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return {
      success: true,
      sellers,
    };
  }

  async approveSeller(sellerId: string, adminId?: string) {
    const seller = await this.userModel.findById(sellerId);
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    if (seller.role !== 'seller') {
      throw new BadRequestException('User is not a seller');
    }

    // Update seller approval status and user status
    seller.status = 'active';
    if (!seller.sellerInfo) {
      seller.sellerInfo = {};
    }
    seller.sellerInfo.approvalStatus = 'approved';
    // SS-2: persist audit trail
    (seller.sellerInfo as any).reviewedAt = new Date();
    if (adminId) (seller.sellerInfo as any).reviewedBy = adminId;
    (seller.sellerInfo as any).rejectionReason = undefined;
    await seller.save();

    // Send approval email to seller (skip if seller has no email — phone-only account)
    if (seller.email) {
      try {
        await this.emailService.sendSellerApprovalEmail(seller.email, seller.name || '');
      } catch (error) {
        // Continue even if email fails — approval state is already saved.
      }
    }

    return {
      success: true,
      message: 'Seller approved successfully',
      seller: {
        _id: seller._id,
        name: seller.name,
        email: seller.email,
        status: seller.status,
        sellerInfo: seller.sellerInfo,
      },
    };
  }

  async rejectSeller(sellerId: string, reason?: string, adminId?: string) {
    const seller = await this.userModel.findById(sellerId);
    if (!seller) {
      throw new NotFoundException('Seller not found');
    }
    if (seller.role !== 'seller') {
      throw new BadRequestException('User is not a seller');
    }

    // Update seller approval status
    seller.status = 'inactive';
    if (!seller.sellerInfo) {
      seller.sellerInfo = {};
    }
    seller.sellerInfo.approvalStatus = 'rejected';
    // SS-2: persist rejection reason + audit trail
    if (reason) (seller.sellerInfo as any).rejectionReason = reason;
    (seller.sellerInfo as any).reviewedAt = new Date();
    if (adminId) (seller.sellerInfo as any).reviewedBy = adminId;
    await seller.save();

    // SS-9: cascade store to inactive when seller is rejected
    await this.storeModel.updateMany({ seller: seller._id }, { status: 'inactive' });

    // Send rejection email to seller (skip if seller has no email)
    if (seller.email) {
      try {
        await this.emailService.sendSellerRejectionEmail(seller.email, seller.name || '', reason);
      } catch (error) {
        // Continue even if email fails — rejection state is already saved.
      }
    }

    return {
      success: true,
      message: 'Seller rejected successfully',
      seller: {
        _id: seller._id,
        name: seller.name,
        email: seller.email,
        status: seller.status,
        sellerInfo: seller.sellerInfo,
      },
      reason,
    };
  }


  // SS-5: server-side paginated seller list
  async getSellers(params: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page || 1;
    const limit = Math.min(params.limit || 20, 100);
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = { role: 'seller' };
    if (params.status && params.status !== 'all') {
      filter['sellerInfo.approvalStatus'] = params.status;
    }
    if (params.search) {
      const rx = new RegExp(params.search.trim(), 'i');
      filter['$or'] = [{ name: rx }, { email: rx }, { 'sellerInfo.businessName': rx }];
    }
    const [sellers, total] = await Promise.all([
      this.userModel.find(filter).select('-password').sort({ createdAt: -1 } as any).skip(skip).limit(limit).lean(),
      this.userModel.countDocuments(filter),
    ]);
    return {
      success: true,
      sellers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // SS-10: request more info from seller
  async requestSellerInfo(sellerId: string, message: string, adminId?: string) {
    const seller = await this.userModel.findById(sellerId);
    if (!seller) throw new NotFoundException('Seller not found');
    if (seller.role !== 'seller') throw new BadRequestException('User is not a seller');
    if (!seller.sellerInfo) seller.sellerInfo = {};
    seller.sellerInfo.approvalStatus = 'info_requested';
    (seller.sellerInfo as any).reviewNotes = message;
    (seller.sellerInfo as any).reviewedAt = new Date();
    if (adminId) (seller.sellerInfo as any).reviewedBy = adminId;
    await seller.save();
    if (seller.email) {
      try {
        await this.emailService.sendSellerRejectionEmail(
          seller.email,
          seller.name || '',
          `Information requested: ${message}`,
        );
      } catch { /* non-fatal */ }
    }
    return { success: true, message: 'Information request sent to seller' };
  }

  // SS-3: bulk approve/reject sellers
  async adminBulkSellers(
    ids: string[],
    action: 'approve' | 'reject',
    reason?: string,
    adminId?: string,
  ) {
    if (!ids?.length) throw new BadRequestException('No seller IDs provided');
    const now = new Date();
    const update: Record<string, unknown> = {
      'sellerInfo.approvalStatus': action === 'approve' ? 'approved' : 'rejected',
      'sellerInfo.reviewedAt': now,
    };
    if (adminId) update['sellerInfo.reviewedBy'] = adminId;
    if (action === 'reject' && reason) update['sellerInfo.rejectionReason'] = reason;
    if (action === 'approve') update['status'] = 'active';
    else update['status'] = 'inactive';
    const result = await this.userModel.updateMany(
      { _id: { $in: ids }, role: 'seller' },
      { $set: update },
    );
    if (action === 'reject') {
      await this.storeModel.updateMany({ seller: { $in: ids } }, { status: 'inactive' });
    }
    return { success: true, modified: result.modifiedCount };
  }

    async getUserDetails(userId: string) {
    const user = await this.userModel.findById(userId).select('-password');
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Get user orders
    const orders = await this.orderModel
      .find({ customer: userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // Get user activity (orders count, products count if seller, etc.)
    const activity = {
      totalOrders: orders.length,
      totalSpent: orders.reduce((sum, order) => sum + (order.total || 0), 0),
      lastOrderDate: orders[0]?.createdAt || null,
      accountCreated: user.createdAt,
      lastLogin: user.lastLogin || user.updatedAt,
    };

    // If seller, get product count and store info (SS-8)
    let storeInfo: { storeId: unknown; storeSlug: string; storeStatus: string } | null = null;
    if (user.role === 'seller') {
      const productCount = await this.productModel.countDocuments({ seller: userId });
      (activity as any).totalProducts = productCount;
      const store = await this.storeModel.findOne({ seller: userId }).select('_id slug status').lean();
      if (store) {
        storeInfo = {
          storeId: store._id,
          storeSlug: (store as any).slug ?? '',
          storeStatus: store.status,
        };
      }
    }

    return {
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        avatar: user.avatar,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        sellerInfo: user.sellerInfo,
        walletBalance: user.walletBalance ?? 0,
        lastLogin: user.lastLogin,
        twoFactor: { enabled: user.twoFactor?.enabled ?? false },
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      orders,
      activity,
      storeInfo,
    };
  }

  async getDisputes(filters?: any) {
    // This will be handled by DisputesService, but we can add admin-specific logic here
    // For now, we'll just import and use DisputesService
    return {
      success: true,
      message: 'Use /disputes endpoint for dispute management',
    };
  }

  async getPlatformAnalytics(startDate?: Date, endDate?: Date, currency: string = 'INR') {
    const rate = this.exchangeRateService.getExchangeRate(currency.toUpperCase() as Currency);
    const matchQuery: any = {};
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = startDate;
      if (endDate) matchQuery.createdAt.$lte = endDate;
    }

    // Daily analytics
    const dailyAnalytics = await this.orderModel.aggregate([
      { $match: { ...matchQuery, status: 'delivered' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // User growth
    const userGrowth = await this.userModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          users: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Product growth
    const productGrowth = await this.productModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          products: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Top sellers
    const topSellers = await this.orderModel.aggregate([
      { $match: { ...matchQuery, status: 'delivered' } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'users',
          localField: 'product.seller',
          foreignField: '_id',
          as: 'seller',
        },
      },
      { $unwind: '$seller' },
      {
        $group: {
          _id: '$product.seller',
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          orders: { $addToSet: '$_id' },
          sellerName: { $first: '$seller.name' },
        },
      },
      {
        $project: {
          sellerId: '$_id',
          sellerName: 1,
          revenue: 1,
          orderCount: { $size: '$orders' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);

    // Category performance
    const categoryPerformance = await this.orderModel.aggregate([
      { $match: { ...matchQuery, status: 'delivered' } },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.category',
          foreignField: '_id',
          as: 'category',
        },
      },
      { $unwind: '$category' },
      {
        $group: {
          _id: '$category._id',
          categoryName: { $first: '$category.name' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          quantity: { $sum: '$items.quantity' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);

    // Period totals for trend deltas
    const periodRevenue = dailyAnalytics.reduce((s: number, d: any) => s + (d.revenue || 0), 0);
    const periodOrders = dailyAnalytics.reduce((s: number, d: any) => s + (d.orders || 0), 0);
    const periodUsers = userGrowth.reduce((s: number, d: any) => s + (d.users || 0), 0);

    // Previous equal-length window for % change (only when an explicit window was given)
    let previousTotals: { revenue: number | null; orders: number | null; users: number | null } = {
      revenue: null, orders: null, users: null,
    };

    if (startDate && endDate) {
      const windowMs = endDate.getTime() - startDate.getTime();
      const prevStart = new Date(startDate.getTime() - windowMs);
      const prevEnd = new Date(startDate.getTime() - 1);
      const prevMatchQuery: any = { createdAt: { $gte: prevStart, $lte: prevEnd } };

      const prevRevOrders = await this.orderModel.aggregate([
        { $match: { ...prevMatchQuery, status: 'delivered' } },
        { $group: { _id: null, revenue: { $sum: '$total' }, orders: { $sum: 1 } } },
      ]);
      const prevUsers = await this.userModel.aggregate([
        { $match: prevMatchQuery },
        { $group: { _id: null, users: { $sum: 1 } } },
      ]);

      const pctChange = (curr: number, prev: number): number | null =>
        prev === 0 ? null : Number(((curr - prev) / prev * 100).toFixed(1));

      const prevRev = (prevRevOrders[0]?.revenue || 0) * rate;
      previousTotals = {
        revenue: pctChange(periodRevenue * rate, prevRev),
        orders: pctChange(periodOrders, prevRevOrders[0]?.orders || 0),
        users: pctChange(periodUsers, prevUsers[0]?.users || 0),
      };
    }

    return {
      success: true,
      analytics: {
        dailyAnalytics: dailyAnalytics.map((d: any) => ({
          ...d,
          revenue: Number((d.revenue * rate).toFixed(2)),
        })),
        userGrowth,
        productGrowth,
        topSellers: topSellers.map((t: any) => ({
          ...t,
          revenue: Number((t.revenue * rate).toFixed(2)),
        })),
        categoryPerformance: categoryPerformance.map((c: any) => ({
          ...c,
          revenue: Number((c.revenue * rate).toFixed(2)),
        })),
        // Period aggregate totals (convenient — avoids client-side summation)
        totals: {
          revenue: Number((periodRevenue * rate).toFixed(2)),
          orders: periodOrders,
          users: periodUsers,
        },
        // Percent-change vs. immediately-preceding equal window (null when not computable)
        trends: previousTotals,
      },
    };
  }

  async getFinancialReport(startDate?: Date, endDate?: Date, currency: string = 'INR') {
    const rate = this.exchangeRateService.getExchangeRate(currency.toUpperCase() as Currency);
    const deliveredQuery: any = { status: 'delivered' };
    const refundedQuery: any = { status: 'refunded' };
    if (startDate || endDate) {
      const dateRange: any = {};
      if (startDate) dateRange.$gte = startDate;
      if (endDate) dateRange.$lte = endDate;
      deliveredQuery.createdAt = dateRange;
      refundedQuery.createdAt = dateRange;
    }

    // Revenue breakdown (delivered orders only)
    const revenueBreakdown = await this.orderModel.aggregate([
      { $match: deliveredQuery },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          totalSubtotal: { $sum: '$subtotal' },
          totalTax: { $sum: '$tax' },
          totalShipping: { $sum: '$shipping' },
          totalDiscount: { $sum: { $ifNull: ['$discount', 0] } },
          orderCount: { $sum: 1 },
        },
      },
    ]);

    // Refund aggregation — sum refunded orders in the same window
    const refundBreakdown = await this.orderModel.aggregate([
      { $match: refundedQuery },
      {
        $group: {
          _id: null,
          totalRefunds: { $sum: '$total' },
          refundCount: { $sum: 1 },
        },
      },
    ]);

    // Monthly revenue (delivered)
    const monthlyRevenue = await this.orderModel.aggregate([
      { $match: deliveredQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Payment method breakdown (delivered)
    const paymentMethodBreakdown = await this.orderModel.aggregate([
      { $match: deliveredQuery },
      {
        $group: {
          _id: '$paymentMethod',
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
    ]);

    const summary = revenueBreakdown[0] || {
      totalRevenue: 0,
      totalSubtotal: 0,
      totalTax: 0,
      totalShipping: 0,
      totalDiscount: 0,
      orderCount: 0,
    };

    const refundSummary = refundBreakdown[0] || { totalRefunds: 0, refundCount: 0 };
    const grossRevenue = summary.totalRevenue * rate;
    const totalRefunds = refundSummary.totalRefunds * rate;
    const netRevenue = grossRevenue - totalRefunds;

    return {
      success: true,
      report: {
        summary: {
          grossRevenue: Number(grossRevenue.toFixed(2)),
          totalRevenue: Number(grossRevenue.toFixed(2)), // backward-compat alias
          totalRefunds: Number(totalRefunds.toFixed(2)),
          refundCount: refundSummary.refundCount,
          netRevenue: Number(netRevenue.toFixed(2)),
          totalSubtotal: Number((summary.totalSubtotal * rate).toFixed(2)),
          totalTax: Number((summary.totalTax * rate).toFixed(2)),
          totalShipping: Number((summary.totalShipping * rate).toFixed(2)),
          totalDiscount: Number((summary.totalDiscount * rate).toFixed(2)),
          orderCount: summary.orderCount,
        },
        monthlyRevenue: monthlyRevenue.map((m: any) => ({
          ...m,
          revenue: Number((m.revenue * rate).toFixed(2)),
        })),
        paymentMethodBreakdown: paymentMethodBreakdown.map((p: any) => ({
          ...p,
          revenue: Number((p.revenue * rate).toFixed(2)),
        })),
      },
    };
  }

  // -------- Order management --------

  async adminUpdateOrder(
    id: string,
    data: {
      status?: string;
      trackingNumber?: string;
      carrier?: string;
      estimatedDelivery?: string | Date;
      note?: string;
      notes?: string;
      paymentStatus?: string;
    },
  ) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    const update: Record<string, unknown> = {};

    // "Mark as paid" for COD / manual-settlement orders. Refunds are NOT
    // allowed here — they must go through the refund endpoint (gateway call).
    if (data.paymentStatus !== undefined && data.paymentStatus !== order.paymentStatus) {
      if (data.paymentStatus !== 'paid') {
        throw new BadRequestException('Only "paid" can be set here; refunds go through the refund action.');
      }
      update.paymentStatus = 'paid';
    }

    if (data.status && data.status !== order.status) {
      // Cancelled / refunded must go through the dedicated cancel & refund
      // endpoints — those restore inventory and process the gateway refund.
      // Letting them through this raw-update path would skip those side
      // effects and leave stock/payments out of sync (data-integrity bug).
      if (data.status === 'cancelled' || data.status === 'refunded') {
        throw new BadRequestException(
          `Use the ${data.status === 'cancelled' ? 'cancel' : 'refund'} action — ` +
            `setting "${data.status}" directly would skip inventory/refund handling.`,
        );
      }
      // Validate against the shared state machine (rejects e.g. delivered->pending).
      assertOrderTransition(order.status, data.status);
      update.status = data.status;

      // Carrier is required when an admin marks an order shipped, matching the
      // seller flow — otherwise the tracking timeline shows "via carrier".
      if (data.status === 'shipped') {
        const carrier = data.carrier ?? order.carrier;
        if (!carrier) {
          throw new BadRequestException('A carrier is required when marking an order as shipped.');
        }
      }
    }

    if (data.trackingNumber !== undefined) update.trackingNumber = data.trackingNumber;
    if (data.carrier !== undefined) update.carrier = data.carrier;
    if (data.estimatedDelivery !== undefined) update.estimatedDelivery = data.estimatedDelivery;
    // Persist admin notes to the real schema field. (Previously written to
    // `note`, which does not exist on the Order schema, so it was dropped.)
    const noteValue = data.notes ?? data.note;
    if (noteValue !== undefined) update.notes = noteValue;

    const updated = await this.orderModel.findByIdAndUpdate(id, update, { new: true });

    // Notify the customer of the status change. Best-effort, fire-and-forget.
    if (data.status && updated) {
      setImmediate(async () => {
        try {
          const o = await this.orderModel.findById(updated._id).populate('customer');
          const email = (o as any)?.customer?.email;
          if (email) await this.emailService.sendOrderStatusUpdateEmail(email, o);
        } catch (err: any) {
          this.logger.warn(`Admin order status email failed for order ${id}: ${err?.message || err}`);
        }
      });
    }

    // Award loyalty points when admin marks an order delivered.
    if (data.status === 'delivered' && this.loyaltyService) {
      const customerId = order.customer?.toString();
      if (customerId) {
        this.loyaltyService
          .awardOrderPoints(customerId, id, (order as any).total ?? 0)
          .catch(() => undefined);
      }
    }

    return { success: true, order: updated };
  }

  async adminBulkUpdateOrders(ids: string[], status: string) {
    // Bulk cancel/refund is forbidden here: each needs inventory restore /
    // gateway refund, which a bulk path can't safely do. Only forward
    // fulfillment transitions are allowed in bulk.
    if (status === 'cancelled' || status === 'refunded') {
      throw new BadRequestException(
        'Bulk cancel/refund is not supported — process these individually so inventory and refunds are handled.',
      );
    }

    const orders = await this.orderModel.find({ _id: { $in: ids } });
    const okIds: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const o of orders) {
      try {
        assertOrderTransition(o.status, status);
        okIds.push(String(o._id));
      } catch {
        skipped.push({ id: String(o._id), reason: `Cannot go ${o.status} → ${status}` });
      }
    }

    const result = okIds.length
      ? await this.orderModel.updateMany({ _id: { $in: okIds } }, { status })
      : { modifiedCount: 0 };

    // Notify each successfully-updated customer of the status change. Best-effort.
    setImmediate(async () => {
      try {
        const updated = await this.orderModel.find({ _id: { $in: okIds } }).populate('customer');
        for (const o of updated) {
          const email = (o as any)?.customer?.email;
          if (email) await this.emailService.sendOrderStatusUpdateEmail(email, o).catch(() => undefined);
        }
      } catch (err: any) {
        this.logger.warn(`Admin bulk status email failed: ${err?.message || err}`);
      }
    });

    return { success: true, modified: result.modifiedCount, skipped };
  }

  // -------- User editing --------

  async adminEditUser(
    id: string,
    data: { name?: string; email?: string; role?: string; phone?: string },
  ) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    const allowedFields = ['name', 'email', 'role', 'phone'] as const;
    const update: Record<string, unknown> = {};
    for (const k of allowedFields) {
      if (data[k] !== undefined) update[k] = data[k];
    }

    // Prevent privilege escalation: admin can change role, but not to 'admin'
    // unless changing FROM admin (de-escalation is fine).
    if (update.role === 'admin' && user.role !== 'admin') {
      throw new BadRequestException('Cannot promote a user to admin via API');
    }

    const updated = await this.userModel
      .findByIdAndUpdate(id, update, { new: true, runValidators: true })
      .select('-password -refreshToken');
    return { success: true, user: updated };
  }

  // -------- Bulk product actions --------

  async adminBulkProducts(
    ids: string[],
    action: 'approve' | 'reject' | 'feature' | 'unfeature',
    reason?: string,
  ) {
    let update: Record<string, unknown> = {};
    // Match single-product approveProduct/rejectProduct semantics: the Product
    // status enum is ['pending','approved','rejected','inactive'] and the
    // storefront queries status:'approved'. Writing 'active' here produced an
    // invalid status that hid bulk-approved products everywhere.
    if (action === 'approve') update = { status: 'approved', $unset: { rejectionReason: '' } };
    else if (action === 'reject') update = { status: 'rejected', rejectionReason: reason };
    else if (action === 'feature') update = { featured: true };
    else if (action === 'unfeature') update = { featured: false };

    const result = await this.productModel.updateMany(
      { _id: { $in: ids } },
      update,
      { runValidators: true },
    );
    return { success: true, modified: result.modifiedCount };
  }

  // -------- Notification management --------

  async getNotifications(page = 1, limit = 20, type?: string, q?: string, from?: string, to?: string) {
    const filter: Record<string, unknown> = {};
    if (type) filter.type = type;
    if (q) {
      const regex = new RegExp(q, 'i');
      filter['$or'] = [{ title: regex }, { message: regex }];
    }
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter['$gte'] = new Date(from);
      if (to) dateFilter['$lte'] = new Date(to);
      filter.createdAt = dateFilter;
    }
    const skip = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .populate('user', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.notificationModel.countDocuments(filter),
    ]);
    return {
      success: true,
      notifications,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /** Legacy broadcast endpoint kept for backward-compatibility. New UI uses createBroadcast. */
  async broadcastNotification(data: {
    title: string;
    message: string;
    type: 'promotion' | 'system' | 'other';
    targetRole?: string;
    userIds?: string[];
  }) {
    let userQuery: Record<string, unknown> = { status: 'active' };
    if (data.userIds && data.userIds.length > 0) {
      userQuery = { _id: { $in: data.userIds } };
    } else if (data.targetRole) {
      userQuery = { status: 'active', role: data.targetRole };
    }

    const users = await this.userModel.find(userQuery).select('_id').lean();
    if (users.length === 0) {
      return { success: true, sent: 0 };
    }

    const docs = users.map((u) => ({
      user: u._id,
      title: data.title,
      message: data.message,
      type: data.type,
      sentAt: new Date(),
    }));

    await this.notificationModel.insertMany(docs);
    return { success: true, sent: docs.length };
  }

  async deleteNotification(id: string) {
    const result = await this.notificationModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Notification not found');
    return { success: true, message: 'Notification deleted' };
  }

  // -------- Broadcast / Campaign management --------

  /** Get audience count for a given targeting config (dry-run preview). */
  async getAudienceCount(opts: {
    targetRoles?: string[];
    targetRole?: string;
    userIds?: string[];
  }) {
    let query: Record<string, unknown>;
    if (opts.userIds && opts.userIds.length > 0) {
      query = { _id: { $in: opts.userIds } };
    } else if (opts.targetRoles && opts.targetRoles.length > 0) {
      query = { status: 'active', role: { $in: opts.targetRoles } };
    } else if (opts.targetRole) {
      query = { status: 'active', role: opts.targetRole };
    } else {
      query = { status: 'active' };
    }
    const count = await this.userModel.countDocuments(query);
    return { success: true, count };
  }

  /** Create a broadcast. If scheduledAt is in the future, status='scheduled'; otherwise dispatch immediately. */
  async createBroadcast(
    data: {
      title: string;
      message: string;
      type: 'promotion' | 'system' | 'other';
      channels?: ('inApp' | 'email')[];
      targetRoles?: string[];
      targetUserIds?: string[];
      actionUrl?: string;
      scheduledAt?: string;
    },
    creatorId: string,
  ) {
    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : undefined;
    const isScheduled = scheduledAt && scheduledAt > new Date();

    const targetUserIds = (data.targetUserIds ?? []).map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    const broadcast = await this.broadcastModel.create({
      title: data.title,
      message: data.message,
      type: data.type,
      channels: data.channels ?? ['inApp'],
      targetRoles: data.targetRoles ?? [],
      targetUserIds,
      actionUrl: data.actionUrl,
      status: isScheduled ? 'scheduled' : 'sending',
      scheduledAt: isScheduled ? scheduledAt : undefined,
      createdBy: new mongoose.Types.ObjectId(creatorId),
      recipientCount: 0,
      deliveredCount: 0,
      readCount: 0,
    });

    if (!isScheduled) {
      // Dispatch immediately
      try {
        const sent = await this.notificationScheduler.dispatchBroadcast(broadcast);
        await this.broadcastModel.updateOne(
          { _id: broadcast._id },
          { $set: { status: 'sent', sentAt: new Date(), recipientCount: sent, deliveredCount: sent } },
        );
        return {
          success: true,
          broadcast: { ...broadcast.toObject(), status: 'sent', recipientCount: sent },
          sent,
          channels: data.channels ?? ['inApp'],
        };
      } catch (err: any) {
        await this.broadcastModel.updateOne({ _id: broadcast._id }, { $set: { status: 'failed' } });
        throw err;
      }
    }

    return {
      success: true,
      broadcast: broadcast.toObject(),
      sent: 0,
      scheduled: true,
      scheduledAt,
    };
  }

  /** List broadcasts (campaigns) with denormalised read counts refreshed from Notification aggregation. */
  async getBroadcasts(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [broadcasts, total] = await Promise.all([
      this.broadcastModel
        .find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'name email')
        .lean<IBroadcast[]>(),
      this.broadcastModel.countDocuments(),
    ]);

    // Refresh readCount for sent campaigns from Notification aggregation
    const sentBroadcastIds = broadcasts
      .filter((b) => b.status === 'sent')
      .map((b) => b._id);

    let readCounts: Record<string, number> = {};
    if (sentBroadcastIds.length > 0) {
      const agg = await this.notificationModel.aggregate([
        { $match: { broadcastId: { $in: sentBroadcastIds }, read: true } },
        { $group: { _id: '$broadcastId', count: { $sum: 1 } } },
      ]);
      readCounts = Object.fromEntries(agg.map((a) => [String(a._id), a.count]));
    }

    const enriched = broadcasts.map((b) => ({
      ...b,
      readCount: readCounts[String(b._id)] ?? b.readCount,
    }));

    return {
      success: true,
      broadcasts: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /** Delete a broadcast campaign and all associated recipient notification rows. */
  async deleteBroadcast(id: string) {
    const broadcast = await this.broadcastModel.findById(id);
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    await this.notificationModel.deleteMany({ broadcastId: broadcast._id });
    await this.broadcastModel.findByIdAndDelete(id);
    return { success: true, message: 'Broadcast and recipient rows deleted' };
  }

  /** Aggregate stats for the Notifications page StatCards. */
  async getBroadcastStats() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalSent30d, scheduled, lastBroadcast, readAgg] = await Promise.all([
      // Total recipient notifications sent in last 30 days (via broadcasts)
      this.notificationModel.countDocuments({
        broadcastId: { $exists: true },
        createdAt: { $gte: thirtyDaysAgo },
      }),
      // Scheduled broadcasts pending
      this.broadcastModel.countDocuments({ status: 'scheduled' }),
      // Most recent sent broadcast
      this.broadcastModel.findOne({ status: 'sent' }).sort({ sentAt: -1 }).lean<IBroadcast>(),
      // Read-rate aggregation across broadcasts in last 30 days
      this.broadcastModel.aggregate([
        { $match: { status: 'sent', sentAt: { $gte: thirtyDaysAgo } } },
        {
          $group: {
            _id: null,
            totalRecipients: { $sum: '$recipientCount' },
            totalRead: { $sum: '$readCount' },
          },
        },
      ]),
    ]);

    const { totalRecipients = 0, totalRead = 0 } = readAgg[0] ?? {};
    const avgReadRate =
      totalRecipients > 0 ? Math.round((totalRead / totalRecipients) * 100) : 0;

    return {
      success: true,
      totalSent30d,
      avgReadRate,
      scheduledCount: scheduled,
      lastSentAt: lastBroadcast?.sentAt ?? null,
    };
  }

  async adminForceLogout(userId: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException('User not found');
    // Stamp revokedAt — future middleware can check this to reject old tokens.
    // Existing short-lived JWTs expire naturally (stateless JWT limitation).
    await this.userModel.updateOne({ _id: userId }, { $set: { sessionsRevokedAt: new Date() } });
    return { success: true, message: 'All sessions have been invalidated. Existing tokens expire on their own schedule.' };
  }

  async adminResendVerification(userId: string): Promise<{ success: boolean; message: string }> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if ((user as any).emailVerified) {
      return { success: false, message: 'Email is already verified' };
    }
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    (user as any).emailVerificationToken = token;
    (user as any).emailVerificationExpire = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await (user as any).save();
    try {
      await this.emailService.sendVerificationEmail((user as any).email, token);
    } catch {
      // Email failure should not roll back the token update
    }
    return { success: true, message: 'Verification email resent successfully' };
  }

  async adminResendOrderEmail(orderId: string): Promise<{ success: boolean; message: string }> {
    const order = await this.orderModel.findById(orderId).populate('customer', 'name email').lean();
    if (!order) throw new NotFoundException('Order not found');
    const email = (order as any).customer?.email;
    if (!email) return { success: false, message: 'Customer has no email address' };
    try {
      if (['delivered', 'refunded'].includes((order as any).status)) {
        await this.emailService.sendOrderStatusUpdateEmail(email, order);
      } else {
        await this.emailService.sendOrderConfirmationEmail(email, order);
      }
      return { success: true, message: 'Order email resent successfully' };
    } catch (err: any) {
      throw new BadRequestException(`Failed to send email: ${err?.message ?? 'Unknown error'}`);
    }
  }

}

