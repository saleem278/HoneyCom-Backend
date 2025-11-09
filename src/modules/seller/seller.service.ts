import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, IProduct } from '../../models/Product.model';
import { Order, IOrder } from '../../models/Order.model';
import { User, IUser } from '../../models/User.model';

@Injectable()
export class SellerService {
  constructor(
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('User') private userModel: Model<IUser>,
  ) {}

  async getDashboard(sellerId: string) {
    const totalProducts = await this.productModel.countDocuments({ seller: sellerId });
    
    // Get seller's product IDs
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);
    
    // Count orders where seller's products are in items
    const totalOrders = await this.orderModel.countDocuments({ 
      'items.product': { $in: productIds } 
    });
    
    // Calculate revenue from delivered orders with seller's products
    const totalRevenue = await this.orderModel.aggregate([
      { $match: { 'items.product': { $in: productIds }, status: 'delivered' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);

    return {
      success: true,
      dashboard: {
        totalProducts,
        totalOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
      },
    };
  }

  async getProducts(sellerId: string) {
    const products = await this.productModel
      .find({ seller: sellerId })
      .populate('category', 'name slug')
      .populate('seller', 'name email')
      .sort({ createdAt: -1 });
    return {
      success: true,
      products,
    };
  }

  async getOrders(sellerId: string) {
    // Get orders where seller's products are in the items
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);
    
    const orders = await this.orderModel
      .find({ 'items.product': { $in: productIds } })
      .populate('customer', 'name email')
      .sort({ createdAt: -1 });
    
    return {
      success: true,
      orders,
    };
  }

  async updateOrderStatus(orderId: string, sellerId: string, updateData: { status: string; trackingNumber?: string; carrier?: string }) {
    const order = await this.orderModel.findById(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Verify seller owns products in this order
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);
    const orderHasSellerProducts = order.items.some((item: any) => 
      productIds.some(pid => pid.toString() === item.product.toString())
    );

    if (!orderHasSellerProducts) {
      throw new BadRequestException('Not authorized to update this order');
    }

    order.status = updateData.status as any;
    if (updateData.trackingNumber) {
      order.trackingNumber = updateData.trackingNumber;
    }
    if (updateData.carrier) {
      order.carrier = updateData.carrier;
    }
    await order.save();

    return {
      success: true,
      order,
    };
  }

  async getSalesReport(sellerId: string, startDate?: Date, endDate?: Date) {
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);

    const matchQuery: any = { 'items.product': { $in: productIds } };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = startDate;
      if (endDate) matchQuery.createdAt.$lte = endDate;
    }

    // Daily sales data
    const dailySales = await this.orderModel.aggregate([
      { $match: { ...matchQuery, status: 'delivered' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
          items: { $sum: { $size: '$items' } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Monthly sales data
    const monthlySales = await this.orderModel.aggregate([
      { $match: { ...matchQuery, status: 'delivered' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Total metrics
    const totals = await this.orderModel.aggregate([
      { $match: { ...matchQuery, status: 'delivered' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: '$total' },
        },
      },
    ]);

    return {
      success: true,
      report: {
        dailySales,
        monthlySales,
        totals: totals[0] || { totalRevenue: 0, totalOrders: 0, averageOrderValue: 0 },
      },
    };
  }

  async getProductPerformance(sellerId: string, startDate?: Date, endDate?: Date) {
    const products = await this.productModel.find({ seller: sellerId }).select('_id name');
    const productIds = products.map(p => p._id);

    const matchQuery: any = { 'items.product': { $in: productIds }, status: 'delivered' };
    if (startDate || endDate) {
      matchQuery.createdAt = {};
      if (startDate) matchQuery.createdAt.$gte = startDate;
      if (endDate) matchQuery.createdAt.$lte = endDate;
    }

    const performance = await this.orderModel.aggregate([
      { $match: matchQuery },
      { $unwind: '$items' },
      { $match: { 'items.product': { $in: productIds } } },
      {
        $group: {
          _id: '$items.product',
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          quantitySold: { $sum: '$items.quantity' },
          orders: { $addToSet: '$_id' },
        },
      },
      {
        $project: {
          productId: '$_id',
          revenue: 1,
          quantitySold: 1,
          orderCount: { $size: '$orders' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 20 },
    ]);

    // Populate product names
    const productsMap = new Map(products.map(p => [p._id.toString(), p.name]));
    const performanceWithNames = performance.map((p) => ({
      ...p,
      productName: productsMap.get(p.productId.toString()) || 'Unknown',
    }));

    return {
      success: true,
      performance: performanceWithNames,
    };
  }

  async getCustomerInsights(sellerId: string) {
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);

    const customerData = await this.orderModel.aggregate([
      { $match: { 'items.product': { $in: productIds }, status: 'delivered' } },
      {
        $group: {
          _id: '$customer',
          totalSpent: { $sum: '$total' },
          orderCount: { $sum: 1 },
          lastOrderDate: { $max: '$createdAt' },
        },
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 50 },
    ]);

    const customerIds = customerData.map(c => c._id);
    const customers = await this.userModel.find({ _id: { $in: customerIds } }).select('name email');

    const customersMap = new Map(customers.map(c => [c._id.toString(), c]));
    const insights = customerData.map((c) => ({
      customerId: c._id,
      customer: customersMap.get(c._id.toString()) || { name: 'Unknown', email: 'N/A' },
      totalSpent: c.totalSpent,
      orderCount: c.orderCount,
      lastOrderDate: c.lastOrderDate,
      averageOrderValue: c.totalSpent / c.orderCount,
    }));

    return {
      success: true,
      insights,
    };
  }
}

