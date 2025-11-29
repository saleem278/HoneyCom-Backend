import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, IOrder } from '../../models/Order.model';
import { Cart, ICart } from '../../models/Cart.model';
import { Product, IProduct } from '../../models/Product.model';
import { Address, IAddress } from '../../models/Address.model';
import { EmailService } from '../../services/email.service';
import { ExchangeRateService } from '../../services/exchange-rate.service';
import { PdfService } from '../../services/pdf.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('Cart') private cartModel: Model<ICart>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Address') private addressModel: Model<IAddress>,
    private emailService: EmailService,
    private exchangeRateService: ExchangeRateService,
    private pdfService: PdfService,
  ) {}

  async create(userId: string, orderData: any) {
    // Use cart items from orderData if provided, otherwise get from cart
    let itemsToProcess = orderData.items;
    let cart: any = null;

    if (!itemsToProcess || itemsToProcess.length === 0) {
      cart = await this.cartModel.findOne({ user: userId }).populate('items.product');
      if (!cart || cart.items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }
      itemsToProcess = cart.items;
    }

    let subtotal = 0;
    const items = [];

    for (const item of itemsToProcess) {
      let product: any;
      
      if (item.productId) {
        // If productId is provided, fetch the product
        product = await this.productModel.findById(item.productId);
      } else {
        // Otherwise, use the populated product from cart
        product = item.product as any;
      }

      if (!product || product.status !== 'approved') {
        throw new BadRequestException(`Product ${product?.name || 'Unknown'} is not available`);
      }
      if (product.inventory < item.quantity) {
        throw new BadRequestException(`Insufficient inventory for ${product.name}`);
      }

      const itemTotal = product.price * item.quantity;
      subtotal += itemTotal;

      items.push({
        product: product._id,
        name: product.name,
        quantity: item.quantity,
        price: product.price,
        image: product.images?.[0] || '',
        variants: item.variants || {},
      });
    }

    const tax = subtotal * 0.1;
    const shipping = subtotal > 0 ? 10 : 0;
    const discount = cart?.couponDiscount || 0;
    const total = subtotal + tax + shipping - discount;

    // Create shipping address document
    const shippingAddressData = orderData.shippingAddress;
    if (!shippingAddressData) {
      throw new BadRequestException('Shipping address is required');
    }

    // Parse fullName into firstName and lastName
    const nameParts = (shippingAddressData.fullName || '').trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    // Create address document
    const address = await this.addressModel.create({
      user: userId,
      type: 'shipping',
      firstName,
      lastName,
      addressLine1: shippingAddressData.address || '',
      addressLine2: shippingAddressData.addressLine2 || '',
      city: shippingAddressData.city || '',
      state: shippingAddressData.state || '',
      zipCode: shippingAddressData.postalCode || shippingAddressData.zipCode || '',
      country: shippingAddressData.country || 'United States',
      phone: shippingAddressData.phone || '0000000000', // Default phone if not provided
      isDefault: false,
    });

    // Map payment method: 'card' -> 'stripe'
    let paymentMethod = orderData.paymentMethod;
    if (paymentMethod === 'card') {
      paymentMethod = 'stripe';
    }
    if (!['stripe', 'paypal', 'cash_on_delivery'].includes(paymentMethod)) {
      throw new BadRequestException(`Invalid payment method: ${paymentMethod}`);
    }

    // SECURITY: Reject exchangeRate if sent by client - it must be calculated server-side
    if (orderData.exchangeRate !== undefined) {
      throw new BadRequestException('Exchange rate cannot be set by client. It is calculated server-side based on currency.');
    }

    // Get currency from orderData or default to INR
    const currency = (orderData.currency || 'INR').toUpperCase() as 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY';
    
    // Validate currency
    const supportedCurrencies = this.exchangeRateService.getSupportedCurrencies();
    if (!supportedCurrencies.includes(currency)) {
      throw new BadRequestException(`Unsupported currency: ${currency}. Supported currencies: ${supportedCurrencies.join(', ')}`);
    }

    // Calculate exchange rate server-side based on currency
    // Exchange rate represents: 1 INR (base) = exchangeRate * targetCurrency
    // For INR, exchangeRate = 1.0 (no conversion)
    const exchangeRate = this.exchangeRateService.getExchangeRate(currency);

    // Generate order number
    const orderCount = await this.orderModel.countDocuments();
    const orderNumber = `ORD-${String(Date.now()).slice(-8)}-${String(orderCount + 1).padStart(4, '0')}`;

    const order = await this.orderModel.create({
      orderNumber,
      customer: userId,
      items,
      shippingAddress: address._id,
      paymentMethod,
      currency,
      exchangeRate,
      subtotal,
      tax,
      shipping,
      discount,
      total,
      status: 'pending',
      paymentStatus: 'pending',
    });

    // Clear cart if it exists
    if (cart) {
      cart.items = [];
      cart.couponCode = undefined;
      cart.couponDiscount = undefined;
      await cart.save();
    }

    // Send confirmation email
    try {
      const orderWithUser = await this.orderModel.findById(order._id).populate('customer');
      await this.emailService.sendOrderConfirmationEmail((orderWithUser as any).customer.email, order);
    } catch (error) {
      // Error sending email
    }

    return {
      success: true,
      order,
    };
  }

  async findAll(userId: string, userRole: string, page: number = 1, limit: number = 20, status?: string) {
    const filter: any = {};
    if (userRole !== 'admin') {
      filter.customer = userId;
    }
    if (status) {
      filter.status = status;
    }

    const skip = (page - 1) * limit;
    const orders = await this.orderModel
      .find(filter)
      .populate('customer', 'name email')
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

  async findOne(id: string, userId: string, userRole: string) {
    const order = await this.orderModel
      .findById(id)
      .populate('shippingAddress', 'firstName lastName addressLine1 addressLine2 city state zipCode country phone')
      .populate('customer', 'name email')
      .lean();

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (userRole !== 'admin' && (order.customer as any)?._id?.toString() !== userId) {
      throw new BadRequestException('Not authorized');
    }

    // Transform items to match frontend expectations
    const orderObj = order as any;
    if (orderObj.items) {
      orderObj.items = orderObj.items.map((item: any) => ({
        ...item,
        product: {
          _id: item.product,
          name: item.name,
          images: [item.image],
          price: item.price,
        },
      }));
    }

    return {
      success: true,
      order: orderObj,
    };
  }

  async cancel(id: string, userId: string, userRole: string) {
    const order = await this.orderModel.findById(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (userRole !== 'admin' && order.customer.toString() !== userId) {
      throw new BadRequestException('Not authorized');
    }

    if (['delivered', 'cancelled'].includes(order.status)) {
      throw new BadRequestException('Cannot cancel this order');
    }

    order.status = 'cancelled';
    await order.save();

    return {
      success: true,
      order,
    };
  }

  async requestReturn(id: string, userId: string, returnData: any) {
    const order = await this.orderModel.findById(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.customer.toString() !== userId) {
      throw new BadRequestException('Not authorized');
    }

    if (!['delivered', 'shipped'].includes(order.status)) {
      throw new BadRequestException('Order is not eligible for return');
    }

    // For now, just update order status to 'refunded'
    // In a full implementation, you'd create a ReturnRequest document
    order.status = 'refunded';
    await order.save();

    return {
      success: true,
      message: 'Return request submitted successfully',
      order,
    };
  }

  async track(id: string, userId: string, userRole: string) {
    const order = await this.orderModel.findById(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Authorization check: admin can access any order, users can only access their own
    if (userRole !== 'admin') {
      const customerId = typeof order.customer === 'object' && order.customer !== null
        ? (order.customer as any)._id?.toString()
        : order.customer?.toString();
      
      if (customerId !== userId) {
        throw new BadRequestException('Not authorized');
      }
    }

    // Generate tracking events based on order status
    const trackingEvents = [];
    
    trackingEvents.push({
      status: 'pending',
      description: 'Order placed',
      timestamp: order.createdAt,
      location: 'Order placed',
    });

    if (order.status !== 'pending') {
      trackingEvents.push({
        status: 'processing',
        description: 'Order confirmed and processing',
        timestamp: order.updatedAt || order.createdAt,
        location: 'Processing center',
      });
    }

    if (['shipped', 'delivered'].includes(order.status)) {
      trackingEvents.push({
        status: 'shipped',
        description: order.trackingNumber 
          ? `Order shipped via ${order.carrier || 'carrier'} - Tracking: ${order.trackingNumber}`
          : 'Order shipped',
        timestamp: order.updatedAt || order.createdAt,
        location: order.carrier || 'Shipping facility',
      });
    }

    if (order.status === 'delivered') {
      trackingEvents.push({
        status: 'delivered',
        description: 'Order delivered',
        timestamp: order.updatedAt || order.createdAt,
        location: 'Delivered',
      });
    }

    return {
      success: true,
      tracking: trackingEvents,
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        trackingNumber: order.trackingNumber,
        carrier: order.carrier,
      },
    };
  }

  async generateInvoice(id: string, userId: string, userRole: string) {
    const order = await this.orderModel.findById(id)
      .populate('customer', 'name email phone')
      .populate('shippingAddress')
      .populate('items.product', '_id')
      .lean();

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Authorization check
    if (userRole !== 'admin' && userRole !== 'seller') {
      const customerId = typeof order.customer === 'object' && order.customer !== null
        ? (order.customer as any)._id?.toString()
        : order.customer?.toString();
      
      if (customerId !== userId) {
        throw new BadRequestException('Not authorized');
      }
    }

    // For sellers, verify they own products in this order
    if (userRole === 'seller') {
      const products = await this.productModel.find({ seller: userId }).select('_id').lean();
      const productIds = products.map((p: any) => p._id.toString());
      const orderHasSellerProducts = (order.items as any[]).some((item: any) => {
        const itemProductId = typeof item.product === 'object' && item.product !== null
          ? item.product._id?.toString()
          : item.product?.toString();
        return productIds.includes(itemProductId);
      });

      if (!orderHasSellerProducts) {
        throw new BadRequestException('Not authorized to view this order');
      }
    }

    // Generate invoice data
    const invoice = {
      invoiceNumber: `INV-${order.orderNumber}`,
      orderNumber: order.orderNumber,
      date: order.createdAt,
      customer: {
        name: typeof order.customer === 'object' ? (order.customer as any).name : 'N/A',
        email: typeof order.customer === 'object' ? (order.customer as any).email : 'N/A',
        phone: typeof order.customer === 'object' ? (order.customer as any).phone : 'N/A',
      },
      shippingAddress: order.shippingAddress,
      items: order.items,
      subtotal: order.subtotal,
      tax: order.tax,
      shipping: order.shipping,
      discount: order.discount,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      status: order.status,
    };

    // Generate PDF invoice
    let pdfUrl = null;
    try {
      pdfUrl = await this.pdfService.generateInvoice(invoice);
    } catch (error) {
      // Error generating PDF invoice
      // Continue without PDF if generation fails
    }

    return {
      success: true,
      invoice,
      pdfUrl,
    };
  }

  async generateShippingLabel(orderId: string, userId: string, userRole: string) {
    const order = await this.orderModel.findById(orderId)
      .populate('shippingAddress')
      .lean();

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Authorization check
    if (userRole !== 'admin' && userRole !== 'seller') {
      const customerId = typeof order.customer === 'object' && order.customer !== null
        ? (order.customer as any)._id?.toString()
        : order.customer?.toString();
      
      if (customerId !== userId) {
        throw new BadRequestException('Not authorized');
      }
    }

    // Generate PDF shipping label
    let pdfUrl = null;
    try {
      pdfUrl = await this.pdfService.generateShippingLabel(order, (order as any).trackingNumber);
    } catch (error) {
      // Error generating shipping label
      throw new BadRequestException('Failed to generate shipping label');
    }

    return {
      success: true,
      pdfUrl,
      message: 'Shipping label generated successfully',
    };
  }

  /**
   * Update order payment status by payment intent ID
   * Used by webhook handlers
   */
  async updatePaymentStatusByIntentId(
    paymentIntentId: string,
    paymentStatus: 'paid' | 'failed' | 'refunded',
    orderStatus?: 'processing' | 'cancelled' | 'refunded',
  ) {
    const order = await this.orderModel.findOne({ paymentIntentId });
    
    if (!order) {
      throw new NotFoundException('Order not found for payment intent');
    }

    const updateData: any = { paymentStatus };
    if (orderStatus) {
      updateData.status = orderStatus;
    }

    // If payment succeeded, set status to processing
    if (paymentStatus === 'paid' && !orderStatus) {
      updateData.status = 'processing';
    }

    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      order._id,
      updateData,
      { new: true }
    );

    return { success: true, order: updatedOrder };
  }
}

