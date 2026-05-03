import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, IOrder } from '../../models/Order.model';
import { Cart, ICart } from '../../models/Cart.model';
import { Product, IProduct } from '../../models/Product.model';
import { Address, IAddress } from '../../models/Address.model';
import { Coupon, ICoupon } from '../../models/Coupon.model';
import { EmailService } from '../../services/email.service';
import { ExchangeRateService } from '../../services/exchange-rate.service';
import { PdfService } from '../../services/pdf.service';
import { assertOrderTransition } from './order-status';

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
    const shipping = subtotal > 0 ? 10 : 0;
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

      const orderCount = await this.orderModel.countDocuments();
      const orderNumber = `ORD-${String(Date.now()).slice(-8)}-${String(orderCount + 1).padStart(4, '0')}`;

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

      // Atomically increment coupon usage so the limit is actually enforced.
      // Done after order.create succeeds — if the increment itself fails,
      // we log but don't fail the order (the order is the user's truth).
      if (cart?.couponCode) {
        try {
          await this.couponModel.updateOne(
            { code: cart.couponCode.toUpperCase() },
            { $inc: { usedCount: 1 } },
          );
        } catch (couponErr: any) {
          this.logger.warn(
            `Failed to increment usage for coupon ${cart.couponCode}: ${couponErr?.message || couponErr}`,
          );
        }
      }
    } catch (err) {
      // Order/address/etc failed after we reserved stock. Give it back.
      await restoreReservations();
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

    // Validate transition (covers both terminal-state and skip-state attempts).
    assertOrderTransition(order.status, 'cancelled');

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

    // For now, just update order status to 'refunded'.
    // (In a full implementation, you'd create a ReturnRequest document.)
    assertOrderTransition(order.status, 'refunded');
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

