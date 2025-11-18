import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, IUser } from '../../models/User.model';
import { Product, IProduct } from '../../models/Product.model';
import { Order, IOrder } from '../../models/Order.model';
import { Category, ICategory } from '../../models/Category.model';
import { PaymentsService } from '../payments/payments.service';
import { EmailService } from '../../services/email.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('Category') private categoryModel: Model<ICategory>,
    private paymentsService: PaymentsService,
    private emailService: EmailService,
  ) {}

  async getDashboard() {
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
    
    // Calculate total revenue
    const totalRevenue = await this.orderModel.aggregate([
      { $match: { status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);

    // Calculate monthly revenue (current month)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const monthlyRevenue = await this.orderModel.aggregate([
      { 
        $match: { 
          status: 'delivered',
          createdAt: { $gte: startOfMonth }
        } 
      },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);

    // Get recent orders (last 5)
    const recentOrders = await this.orderModel
      .find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('customer', 'name email')
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

    return {
      success: true,
      dashboard: {
        totalUsers,
        totalSellers,
        totalProducts,
        totalOrders,
        pendingSellers,
        pendingProducts,
        totalRevenue: totalRevenue[0]?.total || 0,
        monthlyRevenue: monthlyRevenue[0]?.total || 0,
        recentOrders: recentOrders.map((order: any) => ({
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
          revenue: product.revenue,
        })),
      },
    };
  }

  async getUsers() {
    const users = await this.userModel.find();
    return {
      success: true,
      users,
    };
  }

  async approveProduct(productId: string) {
    const product = await this.productModel.findByIdAndUpdate(
      productId,
      { status: 'approved' },
      { new: true }
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return {
      success: true,
      product,
    };
  }

  async rejectProduct(productId: string, reason?: string) {
    const product = await this.productModel.findByIdAndUpdate(
      productId,
      { status: 'rejected' },
      { new: true }
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return {
      success: true,
      product,
      reason,
    };
  }

  async updateUserStatus(userId: string, status: 'active' | 'inactive' | 'suspended') {
    if (!['active', 'suspended'].includes(status)) {
      throw new BadRequestException('Invalid status. Must be "active" or "suspended"');
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

    if (!['delivered', 'shipped', 'processing'].includes(order.status)) {
      throw new BadRequestException('Order cannot be refunded in current status');
    }

    const refundAmount = amount || order.total;
    
    if (refundAmount > order.total) {
      throw new BadRequestException('Refund amount cannot exceed order total');
    }

    // Update order status
    order.status = 'refunded';
    order.paymentStatus = 'refunded';
    await order.save();

    // Process refund through payment gateway if paymentIntentId exists
    if (order.paymentIntentId) {
      try {
        await this.paymentsService.processRefund(order.paymentIntentId, refundAmount, reason);
      } catch (error: any) {
        // Refund processing error
        // Continue with order status update even if payment gateway refund fails
        // Admin can manually process refund later
      }
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
    const sellers = await this.userModel.find({
      role: 'seller',
      'sellerInfo.approvalStatus': 'pending',
    }).select('-password');
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

    // Send approval email to seller
    try {
      await this.emailService.sendSellerApprovalEmail(seller.email, seller.name);
    } catch (error) {
      // Error sending approval email
      // Continue even if email fails
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

    // Send rejection email to seller with reason
    try {
      await this.emailService.sendSellerRejectionEmail(seller.email, seller.name, reason);
    } catch (error) {
      // Error sending rejection email
      // Continue even if email fails
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

  async getPlatformAnalytics(startDate?: Date, endDate?: Date) {
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
        dailyAnalytics,
        userGrowth,
        productGrowth,
        topSellers,
        categoryPerformance,
      },
    };
  }

  async getFinancialReport(startDate?: Date, endDate?: Date) {
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

    return {
      success: true,
      report: {
        summary: revenueBreakdown[0] || {
          totalRevenue: 0,
          totalSubtotal: 0,
          totalTax: 0,
          totalShipping: 0,
          totalDiscount: 0,
          orderCount: 0,
        },
        monthlyRevenue,
        paymentMethodBreakdown,
      },
    };
  }
}

