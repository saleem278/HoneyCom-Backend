import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, IProduct } from '../../models/Product.model';
import { Order, IOrder } from '../../models/Order.model';
import { User, IUser } from '../../models/User.model';
import { assertOrderTransition } from '../orders/order-status';
import { LoyaltyService } from '../loyalty/loyalty.service';

@Injectable()
export class SellerService {
  constructor(
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('User') private userModel: Model<IUser>,
    @Optional() private readonly loyaltyService?: LoyaltyService,
  ) {}

  async getDashboard(sellerId: string) {
    const totalProducts = await this.productModel.countDocuments({ seller: sellerId });

    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);

    const totalOrders = await this.orderModel.countDocuments({
      'items.product': { $in: productIds },
    });

    // Revenue must only count *this seller's* line items, not the whole order.
    // Multi-seller orders previously double-counted: a seller with 1 of 10 items
    // saw the entire order total as their revenue.
    // Also compute net earnings (after platform commission) and total commission.
    // For legacy items that predate the commission fields, fall back to the gross
    // amount as both gross and net so old data doesn't appear to have zero earnings.
    const earningsAgg = await this.orderModel.aggregate([
      { $match: { 'items.product': { $in: productIds }, status: 'delivered' } },
      { $unwind: '$items' },
      { $match: { 'items.product': { $in: productIds } } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          totalNetEarnings: {
            $sum: {
              $ifNull: [
                '$items.sellerEarning',
                { $multiply: ['$items.price', '$items.quantity'] },
              ],
            },
          },
          totalCommission: { $sum: { $ifNull: ['$items.commissionAmount', 0] } },
        },
      },
    ]);

    const earningsSummary = earningsAgg[0] || { totalRevenue: 0, totalNetEarnings: 0, totalCommission: 0 };

    return {
      success: true,
      dashboard: {
        totalProducts,
        totalOrders,
        totalRevenue: earningsSummary.totalRevenue,
        totalNetEarnings: earningsSummary.totalNetEarnings,
        totalCommission: earningsSummary.totalCommission,
      },
    };
  }

  async getProducts(sellerId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    const products = await this.productModel
      .find({ seller: sellerId })
      .populate('category', 'name slug')
      .populate('seller', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await this.productModel.countDocuments({ seller: sellerId });
    
    return {
      success: true,
      products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getOrders(sellerId: string, page: number = 1, limit: number = 20) {
    // Orders with at least one line item owned by this seller. Uses
    // the multikey index on `items.seller` (Order.model.ts) so this
    // is an O(matching-orders) lookup rather than the previous
    // O(orders × seller-products) scan that first fetched every
    // product id and built a giant $in array.
    //
    // Fallback for legacy orders: rows that predate the items.seller
    // backfill won't have the field. We OR-match `items.product` for
    // those to avoid hiding pre-migration orders from the seller view
    // — drop the fallback once a backfill migration has run.
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map((p) => p._id);
    const filter = {
      $or: [
        { 'items.seller': sellerId },
        { 'items.product': { $in: productIds }, 'items.seller': { $exists: false } },
      ],
    };

    const skip = (page - 1) * limit;
    const orders = await this.orderModel
      .find(filter)
      .populate('customer', 'name email')
      .populate('shippingAddress', 'firstName lastName addressLine1 addressLine2 city state zipCode country phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await this.orderModel.countDocuments(filter);

    return {
      success: true,
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getOrderById(orderId: string, sellerId: string) {
    const order = await this.orderModel
      .findById(orderId)
      .populate('customer', 'name email')
      .populate('shippingAddress', 'firstName lastName addressLine1 addressLine2 city state zipCode country phone')
      .populate('items.product', 'name images price')
      .lean();

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Verify seller owns products in this order
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);
    const orderHasSellerProducts = (order.items as any[]).some((item: any) => 
      productIds.some(pid => pid.toString() === item.product?.toString() || pid.toString() === item.product?._id?.toString())
    );

    if (!orderHasSellerProducts) {
      throw new BadRequestException('Not authorized to view this order');
    }

    // Transform items and filter to this seller's items only.
    // Returning all items in a multi-seller order would expose other sellers'
    // product lines and prices. Shipping address is still included so the
    // seller can fulfil their items.
    const orderObj = order as any;
    if (orderObj.items) {
      const productIdSet = new Set(productIds.map((pid: any) => pid.toString()));
      orderObj.items = (orderObj.items as any[])
        .filter((item: any) => {
          const pid = item.product?._id?.toString() ?? item.product?.toString();
          return productIdSet.has(pid);
        })
        .map((item: any) => ({
          ...item,
          product: item.product || {
            _id: item.product,
            name: item.name,
            images: item.image ? [item.image] : [],
            price: item.price,
          },
        }));
    }

    return {
      success: true,
      order: orderObj,
    };
  }

  async updateOrderStatus(orderId: string, sellerId: string, updateData: { status: string; trackingNumber?: string; carrier?: string }) {
    const order = await this.orderModel.findById(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Verify the seller owns *all* the products in this order. Previously a
    // seller with one item in a 10-item multi-seller order could mark the
    // entire order delivered, including other sellers' line items.
    //
    // The clean fix is per-line-item status, but that's a schema redesign.
    // For now, refuse seller updates on multi-seller orders — admin can still
    // take action via the admin panel.
    const sellerProducts = await this.productModel.find({ seller: sellerId }).select('_id');
    const sellerProductIds = new Set(sellerProducts.map(p => p._id.toString()));

    const orderProductIds = order.items.map((item: any) => item.product.toString());
    const allItemsBelongToSeller = orderProductIds.every((pid) => sellerProductIds.has(pid));
    const someItemsBelongToSeller = orderProductIds.some((pid) => sellerProductIds.has(pid));

    if (!someItemsBelongToSeller) {
      throw new BadRequestException('Not authorized to update this order');
    }
    if (!allItemsBelongToSeller) {
      throw new BadRequestException(
        'This order contains items from other sellers. Per-item fulfillment is not yet supported; please contact admin.',
      );
    }

    // Sellers can only advance the order through fulfillment states. Cancellation
    // and refunds are admin/customer actions — refuse them here regardless of
    // what the state machine would otherwise allow.
    const allowedSellerStatuses = new Set(['processing', 'shipped', 'delivered']);
    if (!allowedSellerStatuses.has(updateData.status)) {
      throw new BadRequestException(
        `Sellers can only set status to: ${[...allowedSellerStatuses].join(', ')}`,
      );
    }

    assertOrderTransition(order.status, updateData.status);

    order.status = updateData.status as any;
    if (order.status === 'delivered' && order.paymentMethod === 'cash_on_delivery') {
      order.paymentStatus = 'paid';
    }
    if (updateData.trackingNumber) {
      order.trackingNumber = updateData.trackingNumber;
    }
    if (updateData.carrier) {
      order.carrier = updateData.carrier;
    }
    await order.save();

    // Fire-and-forget: award loyalty points when order is delivered.
    if (order.status === 'delivered' && this.loyaltyService) {
      const customerId = order.customer?.toString();
      if (customerId) {
        this.loyaltyService
          .awardOrderPoints(customerId, order._id.toString(), order.total ?? 0)
          .catch(() => undefined);
      }
    }

    return {
      success: true,
      order,
    };
  }

  async getSalesReport(sellerId: string, startDate?: Date, endDate?: Date) {
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);

    // Default to last 90 days when no date range is provided to prevent
    // full-table scans on large order collections.
    const defaultStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const effectiveStart = startDate ?? defaultStart;
    const effectiveEnd = endDate ?? new Date();

    const matchQuery: any = {
      'items.product': { $in: productIds },
      createdAt: { $gte: effectiveStart, $lte: effectiveEnd },
    };

    // Common pipeline prefix: only delivered orders that include this seller's
    // products, then $unwind so each line item becomes its own document, then
    // re-filter to drop other sellers' line items. From here we can sum
    // accurately on the seller's items only.
    const sellerItemsPipeline = [
      { $match: { ...matchQuery, status: 'delivered' } },
      { $unwind: '$items' },
      { $match: { 'items.product': { $in: productIds } } },
      {
        $addFields: {
          itemRevenue: { $multiply: ['$items.price', '$items.quantity'] },
        },
      },
    ];

    const dailySales = await this.orderModel.aggregate([
      ...sellerItemsPipeline,
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$itemRevenue' },
          // distinct orders (an order with 3 of this seller's items counts once)
          orderIds: { $addToSet: '$_id' },
          items: { $sum: '$items.quantity' },
        },
      },
      {
        $project: {
          _id: 1,
          revenue: 1,
          items: 1,
          orders: { $size: '$orderIds' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const monthlySales = await this.orderModel.aggregate([
      ...sellerItemsPipeline,
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          revenue: { $sum: '$itemRevenue' },
          orderIds: { $addToSet: '$_id' },
        },
      },
      {
        $project: {
          _id: 1,
          revenue: 1,
          orders: { $size: '$orderIds' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totals = await this.orderModel.aggregate([
      ...sellerItemsPipeline,
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$itemRevenue' },
          totalNetEarnings: {
            $sum: { $ifNull: ['$items.sellerEarning', '$itemRevenue'] },
          },
          totalCommission: { $sum: { $ifNull: ['$items.commissionAmount', 0] } },
          orderIds: { $addToSet: '$_id' },
        },
      },
      {
        $project: {
          _id: 0,
          totalRevenue: 1,
          totalNetEarnings: 1,
          totalCommission: 1,
          totalOrders: { $size: '$orderIds' },
          averageOrderValue: {
            $cond: [
              { $eq: [{ $size: '$orderIds' }, 0] },
              0,
              { $divide: ['$totalRevenue', { $size: '$orderIds' }] },
            ],
          },
        },
      },
    ]);

    return {
      success: true,
      report: {
        dailySales,
        monthlySales,
        totals: totals[0] || { totalRevenue: 0, totalNetEarnings: 0, totalCommission: 0, totalOrders: 0, averageOrderValue: 0 },
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

    // Per-customer totals must again only count *this seller's* line items.
    // Previously this summed entire-order totals so a customer who bought 1 of
    // this seller's items in a 10-item cart appeared as a top-spender.
    const customerData = await this.orderModel.aggregate([
      { $match: { 'items.product': { $in: productIds }, status: 'delivered' } },
      { $unwind: '$items' },
      { $match: { 'items.product': { $in: productIds } } },
      {
        $group: {
          _id: '$customer',
          totalSpent: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          orderIds: { $addToSet: '$_id' },
          lastOrderDate: { $max: '$createdAt' },
        },
      },
      {
        $project: {
          totalSpent: 1,
          lastOrderDate: 1,
          orderCount: { $size: '$orderIds' },
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

