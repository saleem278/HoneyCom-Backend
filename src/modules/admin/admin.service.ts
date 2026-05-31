import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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
import { IOrder } from '../../models/Order.model';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../../services/email.service';
import { ExchangeRateService, Currency } from '../../services/exchange-rate.service';
import { AuthService } from '../auth/auth.service';
import { assertOrderTransition } from '../orders/order-status';

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
    @InjectModel('Order') private orderModel: Model<IOrder>,
    private paymentsService: PaymentsService,
    private emailService: EmailService,
    private jwtService: JwtService,
    private authService: AuthService,
    private exchangeRateService: ExchangeRateService,
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

    // Calculate monthly revenue (current calendar month)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthlyRevenue = await this.orderModel.aggregate([
      { $match: { status: 'delivered', createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);

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
        monthlyRevenue: Number(((monthlyRevenue[0]?.total || 0) * rate).toFixed(2)),
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

  async getUsers(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const users = await this.userModel
      .find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await this.userModel.countDocuments();
    
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

    // Stripe (or whichever gateway) MUST succeed before we mark the
    // order refunded. Previously we flipped status first and swallowed
    // gateway failures — that produced "DB says refunded, Stripe never
    // refunded the customer" support tickets that the admin had no
    // way to detect from the dashboard.
    //
    // For paymentIntentId-less orders (cash-on-delivery, manual
    // settlement, etc.) we skip the gateway leg but still flip status;
    // those don't have an external system that could disagree with us.
    if (order.paymentIntentId) {
      try {
        await this.paymentsService.processRefund(order.paymentIntentId, refundAmount, reason);
      } catch (error) {
        // Surface the underlying failure to the caller so the admin
        // sees what went wrong (card declined, refund window passed,
        // already refunded, etc.) instead of getting a generic 500 or
        // a misleading "refund processed" message.
        const message = error instanceof Error ? error.message : 'Payment gateway refund failed';
        this.logger.error(
          `Refund failed for order ${order._id} (paymentIntentId=${order.paymentIntentId}): ${message}`,
        );
        throw new BadRequestException(`Refund failed: ${message}`);
      }
    }

    // Gateway refund succeeded (or wasn't applicable) — safe to mark
    // the order refunded.
    order.status = 'refunded';
    order.paymentStatus = 'refunded';
    await order.save();

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

  async approveSeller(sellerId: string) {
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

  async rejectSeller(sellerId: string, reason?: string) {
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
    await seller.save();

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

    // If seller, get product count
    if (user.role === 'seller') {
      const productCount = await this.productModel.countDocuments({ seller: userId });
      (activity as any).totalProducts = productCount;
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
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      orders,
      activity,
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
      },
    };
  }

  async getFinancialReport(startDate?: Date, endDate?: Date, currency: string = 'INR') {
    const rate = this.exchangeRateService.getExchangeRate(currency.toUpperCase() as Currency);
    const matchQuery: any = { status: 'delivered' };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = startDate;
      if (endDate) matchQuery.createdAt.$lte = endDate;
    }

    // Revenue breakdown
    const revenueBreakdown = await this.orderModel.aggregate([
      { $match: matchQuery },
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

    // Monthly revenue
    const monthlyRevenue = await this.orderModel.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Payment method breakdown
    const paymentMethodBreakdown = await this.orderModel.aggregate([
      { $match: matchQuery },
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

    return {
      success: true,
      report: {
        summary: {
          totalRevenue: Number((summary.totalRevenue * rate).toFixed(2)),
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
    data: { status?: string; trackingNumber?: string; note?: string },
  ) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    const update: Record<string, unknown> = {};
    if (data.status) update.status = data.status;
    if (data.trackingNumber !== undefined) update.trackingNumber = data.trackingNumber;
    if (data.note !== undefined) update.note = data.note;

    const updated = await this.orderModel.findByIdAndUpdate(id, update, { new: true });
    return { success: true, order: updated };
  }

  async adminBulkUpdateOrders(ids: string[], status: string) {
    const result = await this.orderModel.updateMany(
      { _id: { $in: ids } },
      { status },
    );
    return { success: true, modified: result.modifiedCount };
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
    if (action === 'approve') update = { status: 'active' };
    else if (action === 'reject') update = { status: 'inactive', rejectionReason: reason };
    else if (action === 'feature') update = { featured: true };
    else if (action === 'unfeature') update = { featured: false };

    const result = await this.productModel.updateMany(
      { _id: { $in: ids } },
      update,
    );
    return { success: true, modified: result.modifiedCount };
  }

  // -------- Notification management --------

  async getNotifications(page = 1, limit = 20, type?: string) {
    const filter: Record<string, unknown> = {};
    if (type) filter.type = type;
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
}

