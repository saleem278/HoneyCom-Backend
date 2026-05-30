import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { Order, IOrder } from '../../models/Order.model';
import { Cart, ICart } from '../../models/Cart.model';
import { Product, IProduct } from '../../models/Product.model';
import { Address, IAddress } from '../../models/Address.model';
import { Coupon, ICoupon } from '../../models/Coupon.model';
import { EmailService } from '../../services/email.service';
import { ExchangeRateService } from '../../services/exchange-rate.service';
import { PdfService } from '../../services/pdf.service';
import { assertOrderTransition } from './order-status';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectModel('Order') private orderModel: Model<IOrder>,
    @InjectModel('Cart') private cartModel: Model<ICart>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Address') private addressModel: Model<IAddress>,
    @InjectModel('Coupon') private couponModel: Model<ICoupon>,
    private emailService: EmailService,
    private exchangeRateService: ExchangeRateService,
    private pdfService: PdfService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
  ) {}

  /**
   * Extract the customer ID string from an order, regardless of whether
   * the `customer` field has been populated to a User object or remains an ObjectId.
   */
  private extractCustomerId(customer: unknown): string {
    if (customer && typeof customer === 'object' && '_id' in customer) {
      return String((customer as { _id: { toString(): string } })._id);
    }
    return String(customer);
  }

  private convertOrderCurrency(order: any): any {
    if (!order) return order;

    // If order has toObject (is a Mongoose document), convert to plain object
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
    const items: Array<{
      product: any;
      seller: any;
      name: string;
      quantity: number;
      price: number;
      image: string;
      variants: any;
    }> = [];

    // Reserve inventory atomically, item by item. Each `$inc` is conditional on
    // sufficient stock, so concurrent orders cannot oversell. If any reservation
    // fails (out of stock or product gone), we restore previously-reserved items
    // so we don't leave stranded reservations behind.
    const reserved: Array<{ productId: any; quantity: number }> = [];

    try {
      for (const item of itemsToProcess) {
        const productId = item.productId || (item.product as any)?._id;
        if (!productId) {
          throw new BadRequestException('Product ID missing on order item');
        }

        // Conditional $inc: only succeeds if there's enough stock left and the
        // product is approved. `findOneAndUpdate` returns null if the predicate
        // doesn't match — we treat that as out-of-stock.
        const product = await this.productModel.findOneAndUpdate(
          {
            _id: productId,
            status: 'approved',
            inventory: { $gte: item.quantity },
          },
          { $inc: { inventory: -item.quantity } },
          { new: true },
        );

        if (!product) {
          // Either product doesn't exist, isn't approved, or doesn't have stock.
          // Read the row to give a precise error message.
          const probe = await this.productModel.findById(productId).select('name inventory status');
          if (!probe) {
            throw new BadRequestException(`Product ${productId} not found`);
          }
          if (probe.status !== 'approved') {
            throw new BadRequestException(`Product ${probe.name} is not available`);
          }
          throw new BadRequestException(
            `Insufficient inventory for ${probe.name} (requested ${item.quantity}, available ${probe.inventory})`,
          );
        }

        reserved.push({ productId: product._id, quantity: item.quantity });

        const itemTotal = product.price * item.quantity;
        subtotal += itemTotal;

        items.push({
          product: product._id,
          // Snapshot the seller onto the line item so seller-side
          // queries don't need to join through Product (and so future
          // reassignment of a product's seller doesn't rewrite past
          // order history).
          seller: (product as any).seller,
          name: product.name,
          quantity: item.quantity,
          price: product.price,
          image: product.images?.[0] || '',
          variants: item.variants || {},
        });
      }
    } catch (err) {
      // Roll back any reservations we already made before the failure.
      await Promise.all(
        reserved.map((r) =>
          this.productModel.updateOne(
            { _id: r.productId },
            { $inc: { inventory: r.quantity } },
          ),
        ),
      );
      throw err;
    }

    // Helper: roll back any inventory reservations made above. Used in catches
    // below so that downstream failures don't leave stranded reserved stock.
    const restoreReservations = async () => {
      await Promise.all(
        reserved.map((r) =>
          this.productModel.updateOne(
            { _id: r.productId },
            { $inc: { inventory: r.quantity } },
          ),
        ),
      );
    };

    const tax = subtotal * 0.1;
    const shipping = subtotal > 0 ? 500 : 0;
    const discount = cart?.couponDiscount || 0;
    const total = subtotal + tax + shipping - discount;

    let order;
    try {
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
        phone: shippingAddressData.phone || '0000000000',
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

      // SECURITY: Reject exchangeRate if sent by client - must be calculated server-side
      if (orderData.exchangeRate !== undefined) {
        throw new BadRequestException(
          'Exchange rate cannot be set by client. It is calculated server-side based on currency.',
        );
      }

      const currency = (orderData.currency || 'INR').toUpperCase() as
        | 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY';

      const supportedCurrencies = this.exchangeRateService.getSupportedCurrencies();
      if (!supportedCurrencies.includes(currency)) {
        throw new BadRequestException(
          `Unsupported currency: ${currency}. Supported currencies: ${supportedCurrencies.join(', ')}`,
        );
      }

      const exchangeRate = this.exchangeRateService.getExchangeRate(currency);

      // Conditionally redeem the coupon BEFORE creating the order.
      // The previous flow `$inc`-ed usedCount after order create which
      // had two bugs:
      //   1. Race condition — two concurrent orders both passed the
      //      `usedCount < usageLimit` check in applyCoupon, then both
      //      incremented, blowing past the limit.
      //   2. If the increment failed (Mongo write error) we logged and
      //      moved on, meaning the order had a coupon discount that was
      //      never counted against the limit.
      //
      // The conditional `findOneAndUpdate` below either redeems atomically
      // OR returns null. If null, the coupon hit its cap *during* this
      // request — refuse the order so the user can retry without the
      // expired coupon. Reservation rollback happens in the outer catch.
      if (cart?.couponCode) {
        const now = new Date();
        const redeemed = await this.couponModel.findOneAndUpdate(
          {
            code: cart.couponCode.toUpperCase(),
            status: 'active',
            validFrom: { $lte: now },
            validUntil: { $gte: now },
            // Either no limit, OR current usage strictly below limit.
            $or: [
              { usageLimit: { $exists: false } },
              { usageLimit: null },
              { $expr: { $lt: ['$usedCount', '$usageLimit'] } },
            ],
          },
          { $inc: { usedCount: 1 } },
          { new: true },
        );
        if (!redeemed) {
          throw new BadRequestException(
            'Coupon is invalid, expired, or has reached its usage limit.',
          );
        }
      }

      const orderCount = await this.orderModel.countDocuments();
      const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const orderNumber = `ORD-${String(Date.now()).slice(-8)}-${String(orderCount + 1).padStart(4, '0')}-${randomSuffix}`;

      order = await this.orderModel.create({
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
        // Carry the applied coupon onto the order so analytics/refunds can trace it.
        couponCode: cart?.couponCode,
        // Persist the Stripe paymentIntentId if the client created one before
        // calling /orders. The webhook handler uses this to mark paymentStatus
        // when payment_intent.succeeded fires. Without it, webhooks have no
        // way to find the order that a payment refers to.
        paymentIntentId: orderData.paymentIntentId,
        status: 'pending',
        paymentStatus: 'pending',
      });
    } catch (err) {
      // Order/address/etc failed after we reserved stock. Give it back.
      await restoreReservations();
      // If the coupon was conditionally redeemed above but order creation
      // then failed, decrement usedCount so the slot returns to the pool
      // instead of being silently consumed by a non-existent order.
      if (cart?.couponCode) {
        try {
          await this.couponModel.updateOne(
            { code: cart.couponCode.toUpperCase(), usedCount: { $gt: 0 } },
            { $inc: { usedCount: -1 } },
          );
        } catch (decErr) {
          this.logger.warn(
            `Failed to roll back coupon ${cart.couponCode} after order create failed: ${
              decErr instanceof Error ? decErr.message : String(decErr)
            }`,
          );
        }
      }
      throw err;
    }

    // Cart-clear policy:
    //  - cash_on_delivery: no async confirmation, safe to clear now.
    //  - stripe with paymentIntentId: defer until the webhook fires
    //    payment_intent.succeeded so the user doesn't lose their cart if
    //    payment fails. updatePaymentStatusByIntentId() clears the cart on
    //    'paid' and restores inventory on 'failed'.
    //  - stripe without paymentIntentId (older clients that haven't migrated
    //    yet): clear immediately to preserve previous behavior. These orders
    //    won't get webhook updates, so the cart stays in sync with what the
    //    user expects.
    //  - paypal: same as the no-intent path — clear now until PayPal sync
    //    confirmation is wired up.
    const deferCartClear =
      order.paymentMethod === 'stripe' && !!orderData.paymentIntentId;
    if (cart && !deferCartClear) {
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
      order: this.convertOrderCurrency(order),
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
    
    const convertedOrders = orders.map((o) => this.convertOrderCurrency(o));

    return {
      success: true,
      orders: convertedOrders,
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

    // Convert order and its item prices first
    const convertedOrder = this.convertOrderCurrency(order);

    // Transform items to match frontend expectations
    if (convertedOrder.items) {
      convertedOrder.items = convertedOrder.items.map((item: any) => ({
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
      order: convertedOrder,
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

    // Validate transition (covers both terminal-state and skip-state attempts).
    assertOrderTransition(order.status, 'cancelled');

    // Process Stripe refund if it is a paid Stripe order
    if (order.paymentMethod === 'stripe' && order.paymentIntentId && order.paymentStatus === 'paid') {
      try {
        await this.paymentsService.processRefund(order.paymentIntentId, order.total, 'Order cancellation');
        order.paymentStatus = 'refunded';
      } catch (refundError: any) {
        this.logger.warn(`Failed to process Stripe refund for cancellation on order ${order._id}: ${refundError.message}`);
      }
    }

    // Persist the cancellation first, then restore inventory. If a downstream
    // worker double-cancels, the assertion above short-circuits (idempotent).
    order.status = 'cancelled';
    await order.save();

    // Return reserved stock to the catalog. We use $inc rather than recompute
    // so concurrent updates to inventory aren't clobbered.
    await Promise.all(
      order.items.map((item: any) =>
        this.productModel.updateOne(
          { _id: item.product },
          { $inc: { inventory: item.quantity } },
        ),
      ),
    );

    return {
      success: true,
      order: this.convertOrderCurrency(order),
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

    // Enforce 30-day return window from delivery/updated timestamp
    if (order.status === 'delivered') {
      const returnWindowDays = 30;
      const deliveryDate = order.updatedAt;
      const daysSinceDelivery = (Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceDelivery > returnWindowDays) {
        throw new BadRequestException(`Return window of ${returnWindowDays} days has expired for this order.`);
      }
    }

    // Process Stripe refund if there is an active payment intent ID
    if (order.paymentIntentId) {
      try {
        await this.paymentsService.processRefund(order.paymentIntentId, order.total, 'Customer return request');
      } catch (refundError: any) {
        this.logger.warn(`Failed to process Stripe refund for return on order ${order._id}: ${refundError.message}`);
        // We continue anyway so the return can be processed, as admin can process Stripe refund manually
      }
    }

    // Replenish product inventory for all returned items
    try {
      await Promise.all(
        order.items.map((item: any) =>
          this.productModel.updateOne(
            { _id: item.product },
            { $inc: { inventory: item.quantity } },
          ),
        ),
      );
    } catch (inventoryError: any) {
      this.logger.warn(`Failed to replenish inventory on return for order ${order._id}: ${inventoryError.message}`);
    }

    // Update order statuses
    assertOrderTransition(order.status, 'refunded');
    order.status = 'refunded';
    order.paymentStatus = 'refunded';
    await order.save();

    return {
      success: true,
      message: 'Return request submitted successfully',
      order: this.convertOrderCurrency(order),
    };
  }

  async track(id: string, userId: string, userRole: string) {
    const order = await this.orderModel.findById(id);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Authorization check: admin can access any order, users can only access their own
    if (userRole !== 'admin') {
      const customerId = this.extractCustomerId(order.customer);
      
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
      const customerId = this.extractCustomerId(order.customer);
      
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

    // Convert currency first
    const convertedOrder = this.convertOrderCurrency(order);

    // Generate invoice data
    const invoice = {
      invoiceNumber: `INV-${convertedOrder.orderNumber}`,
      orderNumber: convertedOrder.orderNumber,
      date: convertedOrder.createdAt,
      customer: {
        name: typeof convertedOrder.customer === 'object' ? (convertedOrder.customer as any).name : 'N/A',
        email: typeof convertedOrder.customer === 'object' ? (convertedOrder.customer as any).email : 'N/A',
        phone: typeof convertedOrder.customer === 'object' ? (convertedOrder.customer as any).phone : 'N/A',
      },
      shippingAddress: convertedOrder.shippingAddress,
      items: convertedOrder.items,
      subtotal: convertedOrder.subtotal,
      tax: convertedOrder.tax,
      shipping: convertedOrder.shipping,
      discount: convertedOrder.discount,
      total: convertedOrder.total,
      paymentMethod: convertedOrder.paymentMethod,
      paymentStatus: convertedOrder.paymentStatus,
      status: convertedOrder.status,
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
      const customerId = this.extractCustomerId(order.customer);
      
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

    // Idempotency: webhooks can fire more than once. Skip if we've already
    // applied the same paymentStatus, otherwise we'd e.g. re-clear the cart or
    // re-restore inventory on the second delivery of payment_intent.succeeded.
    if (order.paymentStatus === paymentStatus) {
      return { success: true, order };
    }

    const updateData: any = { paymentStatus };
    if (orderStatus) {
      updateData.status = orderStatus;
    }
    if (paymentStatus === 'paid' && !orderStatus) {
      updateData.status = 'processing';
    }

    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      order._id,
      updateData,
      { new: true },
    );

    if (paymentStatus === 'paid') {
      // Now that payment is confirmed, clear the user's cart.
      try {
        const cart = await this.cartModel.findOne({ user: order.customer });
        if (cart) {
          cart.items = [];
          cart.couponCode = undefined;
          cart.couponDiscount = undefined;
          await cart.save();
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to clear cart for order ${order._id} after payment success: ${err?.message || err}`,
        );
      }
    } else if (paymentStatus === 'failed') {
      // Payment failed — release the inventory we reserved at order-create time
      // and mark the order cancelled so it doesn't sit as a zombie.
      try {
        await Promise.all(
          order.items.map((item: any) =>
            this.productModel.updateOne(
              { _id: item.product },
              { $inc: { inventory: item.quantity } },
            ),
          ),
        );
        await this.orderModel.updateOne(
          { _id: order._id },
          { status: 'cancelled' },
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to release inventory for failed payment on order ${order._id}: ${err?.message || err}`,
        );
      }
    }

    return { success: true, order: updatedOrder };
  }
}

