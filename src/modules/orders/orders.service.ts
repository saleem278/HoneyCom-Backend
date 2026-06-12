import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import * as crypto from 'crypto';
import { Order, IOrder } from '../../models/Order.model';
import { Cart, ICart } from '../../models/Cart.model';
import { Product, IProduct } from '../../models/Product.model';
import { Address, IAddress } from '../../models/Address.model';
import { Coupon, ICoupon } from '../../models/Coupon.model';
import { Settings, ISettings } from '../../models/Settings.model';
import { IUser } from '../../models/User.model';
import { IFlashSale } from '../../models/FlashSale.model';
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
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('FlashSale') private flashSaleModel: Model<IFlashSale>,
    @InjectConnection() private connection: Connection,
    private emailService: EmailService,
    private exchangeRateService: ExchangeRateService,
    private pdfService: PdfService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
  ) {}

  /**
   * Fire-and-forget: email the order's customer an order-status update.
   * SMTP is not transactional — never let a mail failure surface to the caller.
   */
  private async isNotificationEnabled(key: string): Promise<boolean> {
    const row = await this.settingsModel.findOne({ key }).lean() as any;
    // Default to enabled when the setting is absent; explicit false disables.
    return row?.value !== false && row?.value !== 'false';
  }

  private notifyCustomerStatus(orderId: any): void {
    setImmediate(async () => {
      try {
        if (!await this.isNotificationEnabled('notifications.orderStatusEnabled')) return;
        const o = await this.orderModel.findById(orderId).populate('customer');
        const email = (o as any)?.customer?.email;
        if (email) await this.emailService.sendOrderStatusUpdateEmail(email, o);
      } catch (err: any) {
        this.logger.warn(`Order status email failed for order ${orderId}: ${err?.message || err}`);
      }
    });
  }

  /** Fire-and-forget: email the order's customer a refund confirmation. */
  private notifyCustomerRefund(orderId: any, amount?: number, reason?: string): void {
    setImmediate(async () => {
      try {
        if (!await this.isNotificationEnabled('notifications.orderStatusEnabled')) return;
        const o = await this.orderModel.findById(orderId).populate('customer');
        const email = (o as any)?.customer?.email;
        if (email) await this.emailService.sendOrderRefundedEmail(email, o, amount, reason);
      } catch (err: any) {
        this.logger.warn(`Refund email failed for order ${orderId}: ${err?.message || err}`);
      }
    });
  }

  /** Fire-and-forget: notify each seller of the line items they need to fulfil. */
  private notifySellersOfNewOrder(order: any): void {
    setImmediate(async () => {
      try {
        if (!await this.isNotificationEnabled('notifications.orderStatusEnabled')) return;
        const bySeller = new Map<string, any[]>();
        for (const it of order.items || []) {
          const sid = it.seller ? it.seller.toString() : null;
          if (!sid) continue;
          if (!bySeller.has(sid)) bySeller.set(sid, []);
          bySeller.get(sid)!.push(it);
        }
        if (!bySeller.size) return;
        const sellers = await this.userModel
          .find({ _id: { $in: [...bySeller.keys()] } })
          .select('name email');
        for (const s of sellers) {
          if (!s.email) continue;
          await this.emailService
            .sendNewOrderToSellerEmail({
              to: s.email,
              sellerName: s.name || 'Seller',
              order,
              items: bySeller.get(s._id.toString()) || [],
            })
            .catch(() => undefined);
        }
      } catch (err: any) {
        this.logger.warn(`Seller new-order email failed for order ${order?._id}: ${err?.message || err}`);
      }
    });
  }

  /**
   * Read order-related settings from the Settings collection.
   * Fallbacks match cart.service.ts so both services agree on the same numbers.
   * Admin can update these via PUT /settings/bulk without a deploy.
   */
  private async getOrderSettings(): Promise<{
    taxRate: number;
    taxMethod: 'percentage' | 'fixed';
    shippingFlat: number;
    freeShippingAbove: number;
    returnWindowDays: number;
    commissionRate: number;
    codEnabled: boolean;
  }> {
    const rows = await this.settingsModel
      .find({ key: { $in: ['order.taxRate', 'order.taxMethod', 'order.shippingFlat', 'order.freeShippingAbove', 'order.returnWindowDays', 'platform.commissionRate', 'payment.codEnabled'] } })
      .lean();
    const map = new Map(rows.map((r: any) => [r.key, r.value]));
    const taxRate = Number(map.get('order.taxRate') ?? 0.18);
    const taxMethodRaw = String(map.get('order.taxMethod') ?? 'percentage');
    const shippingFlat = Number(map.get('order.shippingFlat') ?? 99);
    const freeShippingAbove = Number(map.get('order.freeShippingAbove') ?? 499);
    const returnWindowDays = Number(map.get('order.returnWindowDays') ?? 30);
    const commissionRate = Number(map.get('platform.commissionRate') ?? 0.10);
    // codEnabled defaults to true so existing installs keep working after upgrade.
    const codEnabledRaw = map.get('payment.codEnabled');
    const codEnabled = codEnabledRaw === undefined || codEnabledRaw === null
      ? true
      : codEnabledRaw === true || codEnabledRaw === 'true' || codEnabledRaw === 'yes' || codEnabledRaw === 1;
    return {
      taxRate: Number.isFinite(taxRate) && taxRate >= 0 ? taxRate : 0.18,
      taxMethod: taxMethodRaw === 'fixed' ? 'fixed' : 'percentage',
      shippingFlat: Number.isFinite(shippingFlat) && shippingFlat >= 0 ? shippingFlat : 99,
      freeShippingAbove: Number.isFinite(freeShippingAbove) && freeShippingAbove >= 0 ? freeShippingAbove : 499,
      returnWindowDays: Number.isFinite(returnWindowDays) && returnWindowDays > 0 ? returnWindowDays : 30,
      commissionRate: Number.isFinite(commissionRate) && commissionRate >= 0 && commissionRate <= 1 ? commissionRate : 0.10,
      codEnabled,
    };
  }

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
    // Wrap the entire order creation in a MongoDB session so inventory
    // decrements, coupon redemption, address creation, and order insert
    // are all atomic. If any step fails the session aborts and all writes
    // are rolled back — no stranded reservations or orphaned coupons.
    // Note: transactions require a replica set (or Atlas). On standalone
    // MongoDB (local dev) the session is opened but transactions aren't
    // enforced — the rollback logic below handles that case manually.
    const session = await this.connection.startSession();

    try {
      let result: any;
      await session.withTransaction(async () => {
        result = await this._createWithSession(userId, orderData, session);
      });
      // withTransaction return value is unreliable on standalone MongoDB
      // (returns session metadata instead of callback result). Always use
      // the captured variable instead.
      return result;
    } finally {
      await session.endSession();
    }
  }

  private async _createWithSession(userId: string, orderData: any, session: any) {
    // Use cart items from orderData if provided, otherwise get from cart
    let itemsToProcess = orderData.items;
    let cart: any = null;

    if (!itemsToProcess || itemsToProcess.length === 0) {
      cart = await this.cartModel.findOne({ user: userId }).populate('items.product').session(session);
      if (!cart || cart.items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }
      itemsToProcess = cart.items;
    }

    // Fetch all order-level settings upfront so the commission rate is
    // available when building each line item and doesn't require a second
    // DB round-trip later in the method.
    const { taxRate, taxMethod, shippingFlat, freeShippingAbove, commissionRate, codEnabled } = await this.getOrderSettings();

    let subtotal = 0;
    const items: Array<{
      product: any;
      seller: any;
      name: string;
      quantity: number;
      price: number;
      image: string;
      variants: any;
      commissionRate?: number;
      commissionAmount?: number;
      sellerEarning?: number;
    }> = [];

    // Pre-fetch active flash sales for all products in this order in one query.
    // We look up sales whose window covers now and whose stockLimit isn't exhausted
    // (stockLimit=0 means unlimited). We'll use these to substitute salePrice for
    // product.price on qualifying items.
    const productIds = itemsToProcess.map((i: any) => i.productId || (i.product as any)?._id).filter(Boolean);
    const flashSaleNow = new Date();
    const activeFlashSales = await this.flashSaleModel
      .find({
        product: { $in: productIds },
        isActive: true,
        startTime: { $lte: flashSaleNow },
        endTime: { $gt: flashSaleNow },
        $or: [{ stockLimit: 0 }, { $expr: { $lt: ['$soldCount', '$stockLimit'] } }],
      })
      .lean();
    // Build a map productId -> flash sale so per-item lookup is O(1).
    const flashSaleByProduct = new Map<string, any>();
    for (const fs of activeFlashSales) {
      flashSaleByProduct.set(fs.product.toString(), fs);
    }
    // Track which flash sale IDs need soldCount incremented after order creation.
    const flashSaleIncrements: Array<{ id: string; qty: number }> = [];

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
          { new: true, session },
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

        // Apply flash-sale price if an active sale exists for this product.
        const flashSale = flashSaleByProduct.get(product._id.toString());
        const effectivePrice = flashSale ? flashSale.salePrice : product.price;
        if (flashSale) {
          flashSaleIncrements.push({ id: flashSale._id.toString(), qty: item.quantity });
        }

        const itemTotal = effectivePrice * item.quantity;
        subtotal += itemTotal;

        const commissionAmount = Number((itemTotal * commissionRate).toFixed(2));
        const sellerEarning = Number((itemTotal - commissionAmount).toFixed(2));

        items.push({
          product: product._id,
          // Snapshot the seller onto the line item so seller-side
          // queries don't need to join through Product (and so future
          // reassignment of a product's seller doesn't rewrite past
          // order history).
          seller: (product as any).seller,
          name: product.name,
          quantity: item.quantity,
          price: effectivePrice,
          image: product.images?.[0] || '',
          variants: item.variants || {},
          // Snapshot commission at order time — rate changes don't
          // retroactively alter what sellers earned on past orders.
          commissionRate,
          commissionAmount,
          sellerEarning,
        });
      }
    } catch (err) {
      // Roll back any reservations we already made before the failure.
      // The transaction abort handles this on replica sets; this is the
      // manual fallback for standalone dev MongoDB.
      await Promise.all(
        reserved.map((r) =>
          this.productModel.updateOne(
            { _id: r.productId },
            { $inc: { inventory: r.quantity } },
            { session },
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
            { session },
          ),
        ),
      );
    };

    // Branch on taxMethod: 'percentage' multiplies the subtotal; 'fixed' adds a flat charge.
    const tax = taxMethod === 'fixed' ? taxRate : subtotal * taxRate;
    const shipping = subtotal > 0 && subtotal < freeShippingAbove ? shippingFlat : 0;
    let discount = 0;
    let total = 0;

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
      const [address] = await this.addressModel.create([{
        user: userId,
        type: 'shipping',
        firstName,
        lastName,
        addressLine1: shippingAddressData.address || '',
        addressLine2: shippingAddressData.addressLine2 || '',
        city: shippingAddressData.city || '',
        state: shippingAddressData.state || '',
        zipCode: shippingAddressData.postalCode || shippingAddressData.zipCode || '',
        country: shippingAddressData.country || 'India',
        phone: shippingAddressData.phone || '0000000000',
        isDefault: false,
      }], { session });

      // Map payment method: 'card' -> 'razorpay'
      let paymentMethod = orderData.paymentMethod;
      if (paymentMethod === 'card') {
        paymentMethod = 'razorpay';
      }
      if (!['razorpay', 'paypal', 'cash_on_delivery'].includes(paymentMethod)) {
        throw new BadRequestException(`Invalid payment method: ${paymentMethod}`);
      }
      // Gate COD on the admin toggle (payment.codEnabled). Defaults to true for
      // backward compatibility so existing installs keep working after upgrade.
      if (paymentMethod === 'cash_on_delivery' && !codEnabled) {
        throw new BadRequestException('Cash on Delivery is not available at this time');
      }

      // SECURITY: Two Razorpay order-creation patterns coexist:
      //
      //  A. Pre-payment (web/frontend): order is created first with only
      //     razorpayOrderId (payment not yet completed). Payment status is
      //     confirmed later via the Razorpay webhook. No signature available yet.
      //
      //  B. Post-payment (mobile): order is created after the Razorpay SDK
      //     completes, forwarding razorpayOrderId + razorpayPaymentId +
      //     razorpaySignature. Signature MUST be verified server-side here
      //     because this path doesn't rely on the webhook for payment confirmation.
      //
      // Rule: when both razorpayOrderId AND razorpayPaymentId are present we
      // are on path B — require and verify the signature. When only
      // razorpayOrderId is present we are on path A — allow, webhook handles it.
      if (paymentMethod === 'razorpay' && orderData.razorpayOrderId && orderData.razorpayPaymentId) {
        const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
        const razorpayConfigured = this.paymentsService.isRazorpayConfigured();

        if (razorpayConfigured || isProd) {
          if (!orderData.razorpaySignature) {
            throw new BadRequestException('razorpaySignature is required when razorpayPaymentId is provided');
          }
          const signatureValid = this.paymentsService.verifyPaymentSignature(
            orderData.razorpayOrderId,
            orderData.razorpayPaymentId,
            orderData.razorpaySignature,
          );
          if (!signatureValid) {
            throw new BadRequestException('Razorpay payment signature verification failed');
          }
        }
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

      // Block until live rates have been fetched at least once so orders
      // are never priced on stale static-fallback rates.
      await this.exchangeRateService.ensureRatesLoaded();
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
        // Per-user guard: redeem only if this user is still below perUserLimit.
        // `$getField` reads userUsage.<userId> dynamically (the userId can't be
        // a literal dotted key in the filter), coalescing a missing entry to 0.
        // When perUserLimit is unset/null this clause passes unconditionally,
        // preserving the previous behaviour. The global and per-user checks
        // share the same atomic findOneAndUpdate, so concurrent orders by the
        // same user can't race past either limit.
        const perUserOk = {
          $or: [
            { perUserLimit: { $exists: false } },
            { perUserLimit: null },
            {
              $expr: {
                $lt: [
                  { $ifNull: [{ $getField: { field: { $literal: userId }, input: '$userUsage' } }, 0] },
                  '$perUserLimit',
                ],
              },
            },
          ],
        };
        const redeemed = await this.couponModel.findOneAndUpdate(
          {
            code: cart.couponCode.toUpperCase(),
            status: 'active',
            validFrom: { $lte: now },
            validUntil: { $gte: now },
            // Both the global usage limit and the per-user limit must pass.
            $and: [
              {
                // Either no global limit, OR current usage strictly below it.
                $or: [
                  { usageLimit: { $exists: false } },
                  { usageLimit: null },
                  { $expr: { $lt: ['$usedCount', '$usageLimit'] } },
                ],
              },
              perUserOk,
            ],
          },
          { $inc: { usedCount: 1, [`userUsage.${userId}`]: 1 } },
          { new: true, session },
        );
        if (!redeemed) {
          throw new BadRequestException(
            'Coupon is invalid, expired, or has reached its usage limit (including any per-customer limit).',
          );
        }

        // Validate minimum purchase
        if (redeemed.minPurchase && subtotal < redeemed.minPurchase) {
          throw new BadRequestException(
            `Minimum purchase of ${redeemed.minPurchase} required for coupon ${redeemed.code}`,
          );
        }

        // Calculate discount based on eligible products/categories.
        // Batch-fetch all products in a single query instead of one per item
        // to avoid N+1 performance issues on large orders.
        let eligibleSubtotal = 0;
        const needsProductDetails =
          (redeemed.applicableProducts && redeemed.applicableProducts.length > 0) ||
          (redeemed.applicableCategories && redeemed.applicableCategories.length > 0);

        let productsMap: Map<string, any> = new Map();
        if (needsProductDetails) {
          const productIds = items.map((i) => i.product);
          const products = await this.productModel
            .find({ _id: { $in: productIds } })
            .select('_id category')
            .lean();
          products.forEach((p: any) => productsMap.set(p._id.toString(), p));
        }

        for (const item of items) {
          let isEligible = true;
          if (needsProductDetails) {
            const product = productsMap.get(item.product.toString());
            if (!product) { isEligible = false; }
            else {
              if (redeemed.applicableProducts && redeemed.applicableProducts.length > 0) {
                isEligible = redeemed.applicableProducts.some(
                  (pId) => pId.toString() === product._id.toString()
                );
              }
              if (isEligible && redeemed.applicableCategories && redeemed.applicableCategories.length > 0) {
                isEligible = redeemed.applicableCategories.some(
                  (cId) => cId.toString() === product.category?.toString()
                );
              }
            }
          }
          if (isEligible) {
            eligibleSubtotal += item.price * item.quantity;
          }
        }

        let calculatedDiscount = 0;
        if (redeemed.type === 'percentage') {
          calculatedDiscount = (eligibleSubtotal * redeemed.value) / 100;
          if (redeemed.maxDiscount) {
            calculatedDiscount = Math.min(calculatedDiscount, redeemed.maxDiscount);
          }
        } else {
          if (eligibleSubtotal > 0) {
            calculatedDiscount = Math.min(redeemed.value, eligibleSubtotal);
          }
        }

        discount = Math.min(calculatedDiscount, subtotal);
      }

      // Apply referral discount (additive with coupon, capped at subtotal)
      if (cart?.referralCode && (cart?.referralDiscount ?? 0) > 0) {
        const referralDiscount = Math.min(cart.referralDiscount, subtotal - discount);
        if (referralDiscount > 0) discount += referralDiscount;
      }

      total = Math.max(0, subtotal + tax + shipping - discount);

      const orderCount = await this.orderModel.countDocuments();
      const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const orderNumber = `ORD-${String(Date.now()).slice(-8)}-${String(orderCount + 1).padStart(4, '0')}-${randomSuffix}`;

      const [createdOrder] = await this.orderModel.create([{
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
        shippingMethod: orderData.shippingMethod || undefined,
        discount,
        total,
        couponCode: cart?.couponCode,
        razorpayOrderId: orderData.razorpayOrderId,
        razorpayPaymentId: orderData.razorpayPaymentId,
        status: 'pending',
        paymentStatus: 'pending',
      }], { session });
      order = createdOrder;
    } catch (err) {
      // Transaction abort handles rollback on replica sets. The calls below
      // are the manual fallback for standalone dev MongoDB where transactions
      // are no-ops. They're idempotent so safe to run either way.
      await restoreReservations();
      if (cart?.couponCode) {
        try {
          // Roll back BOTH the global usedCount and this user's per-user count
          // so a failed order doesn't permanently consume either allotment.
          // Guard each decrement so we never push a counter below zero.
          await this.couponModel.updateOne(
            { code: cart.couponCode.toUpperCase(), usedCount: { $gt: 0 } },
            { $inc: { usedCount: -1 } },
            { session },
          );
          await this.couponModel.updateOne(
            {
              code: cart.couponCode.toUpperCase(),
              [`userUsage.${userId}`]: { $gt: 0 },
            },
            { $inc: { [`userUsage.${userId}`]: -1 } },
            { session },
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
    //  - razorpay with razorpayOrderId: defer until the webhook fires
    //    payment.captured so the user doesn't lose their cart if payment fails.
    //    updatePaymentStatusByRazorpayOrderId() clears the cart on 'paid'.
    //  - paypal: clear now until PayPal sync confirmation is wired up.
    const deferCartClear =
      order.paymentMethod === 'razorpay' && !!orderData.razorpayOrderId;

    // Capture referral code before cart is cleared
    const referralCodeFromCart = cart?.referralCode;

    if (cart && !deferCartClear) {
      cart.items = [];
      cart.couponCode = undefined;
      cart.couponDiscount = undefined;
      cart.referralCode = undefined;
      cart.referralDiscount = undefined;
      await cart.save({ session });
    }

    // Credit referrer outside transaction — a DB failure here should not roll
    // back the order. For Razorpay orders the cart-clear (and thus the credit)
    // is deferred to the payment-success webhook; see
    // updatePaymentStatusByRazorpayOrderId, which calls creditReferral once
    // payment is confirmed. COD/PayPal credit immediately here.
    if (referralCodeFromCart && !deferCartClear) {
      this.creditReferral(referralCodeFromCart, userId);
    }

    // Send confirmation email outside the transaction — SMTP is not
    // transactional and we don't want a mail failure to roll back a valid order.
    // Fire-and-forget after the transaction commits.
    setImmediate(async () => {
      try {
        const orderWithUser = await this.orderModel.findById(order._id).populate('customer');
        const customerEmail = (orderWithUser as any)?.customer?.email;
        if (customerEmail) {
          await this.emailService.sendOrderConfirmationEmail(customerEmail, order);
        }
      } catch (emailErr: any) {
        this.logger.warn(
          `Order confirmation email failed for order ${order._id}: ${emailErr?.message || emailErr}`,
        );
      }
    });

    // Notify the seller(s) of the new order so they can begin fulfilment.
    this.notifySellersOfNewOrder(order);

    // Increment flash-sale soldCount outside the session — these counters
    // are best-effort analytics. A failure here must not roll back the order.
    if (flashSaleIncrements.length > 0) {
      setImmediate(async () => {
        for (const inc of flashSaleIncrements) {
          try {
            await this.flashSaleModel.findByIdAndUpdate(inc.id, { $inc: { soldCount: inc.qty } });
          } catch (err: any) {
            this.logger.warn(`Flash sale soldCount increment failed for ${inc.id}: ${err?.message || err}`);
          }
        }
      });
    }

    return {
      success: true,
      order: this.convertOrderCurrency(order),
    };
  }

  async findAll(
    userId: string,
    userRole: string,
    page: number = 1,
    limit: number = 20,
    status?: string,
    search?: string,
    paymentStatus?: string,
    startDate?: string,
    endDate?: string,
  ) {
    // Clamp to safe ranges to prevent memory exhaustion.
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const filter: any = {};
    if (userRole === 'seller') {
      // Sellers see orders that contain at least one of their products.
      // Snapshot the seller ID onto each order line item so this join is cheap.
      filter['items.seller'] = userId;
    } else if (userRole !== 'admin') {
      filter.customer = userId;
    }
    if (status) {
      filter.status = status;
    }
    if (paymentStatus) {
      filter.paymentStatus = paymentStatus;
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    if (search?.trim()) {
      const rx = new RegExp(search.trim(), 'i');
      // Search on orderNumber; customer email search requires a sub-query
      const customerIds = await this.userModel
        .find({ $or: [{ email: rx }, { name: rx }] })
        .select('_id')
        .lean()
        .then(docs => docs.map(d => d._id));
      filter.$or = [{ orderNumber: rx }, { customer: { $in: customerIds } }];
    }

    const skip = (safePage - 1) * safeLimit;
    const orders = await this.orderModel
      .find(filter)
      .populate('customer', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean();
    
    const total = await this.orderModel.countDocuments(filter);
    
    const convertedOrders = orders.map((o) => this.convertOrderCurrency(o));

    return {
      success: true,
      orders: convertedOrders,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
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

    if (userRole === 'admin') {
      // Admin can view any order — no further check needed.
    } else if (userRole === 'seller') {
      // Sellers may only view orders that contain at least one of their products.
      const sellerProducts = await this.productModel
        .find({ seller: userId })
        .select('_id')
        .lean();
      const sellerProductIds = new Set(sellerProducts.map((p: any) => p._id.toString()));
      const hasSellerItem = (order.items as any[]).some((item: any) => {
        const pid = item.seller?.toString() ?? item.product?.toString();
        return pid && sellerProductIds.has(pid);
      });
      if (!hasSellerItem) {
        throw new BadRequestException('Not authorized');
      }
    } else {
      // Customer: must own the order.
      if ((order.customer as any)?._id?.toString() !== userId) {
        throw new BadRequestException('Not authorized');
      }
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

    if (userRole !== 'admin' && order.customer?.toString() !== userId) {
      throw new BadRequestException('Not authorized');
    }

    // Validate transition (covers both terminal-state and skip-state attempts).
    assertOrderTransition(order.status, 'cancelled');

    // Process Razorpay refund if it is a paid Razorpay order
    if (order.paymentMethod === 'razorpay' && (order as any).razorpayPaymentId && order.paymentStatus === 'paid') {
      try {
        await this.paymentsService.processRefund((order as any).razorpayPaymentId, order.total, 'Order cancellation');
        order.paymentStatus = 'refunded';
      } catch (refundError: any) {
        this.logger.warn(`Failed to process Razorpay refund for cancellation on order ${order._id}: ${refundError.message}`);
      }
    }

    // Persist the cancellation first, then restore inventory. If a downstream
    // worker double-cancels, the assertion above short-circuits (idempotent).
    order.status = 'cancelled';
    await order.save();

    // Notify the customer their order was cancelled (and refunded, if applicable).
    this.notifyCustomerStatus(order._id);

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

    if (order.status !== 'delivered') {
      throw new BadRequestException('Order is not eligible for return. Only delivered orders can be returned.');
    }

    const { returnWindowDays } = await this.getOrderSettings();
    const deliveryDate = order.updatedAt;
    const daysSinceDelivery = (Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDelivery > returnWindowDays) {
      throw new BadRequestException(`Return window of ${returnWindowDays} days has expired for this order.`);
    }

    // Validate the status transition FIRST so we don't initiate a refund and
    // then fail to update the order (refund without status update is worse than
    // the transition error surfacing cleanly before any money moves).
    assertOrderTransition(order.status, 'refunded');

    // Process refund based on payment method.
    // Razorpay (razorpayPaymentId present) supports automatic refunds.
    // For PayPal and cash_on_delivery, skip automatic refund —
    // those methods require manual admin action via the admin panel.
    if (order.paymentMethod === 'razorpay') {
      if (!(order as any).razorpayPaymentId) {
        throw new BadRequestException(
          'Cannot automatically refund this order: payment ID is missing. Please contact support.',
        );
      }
      try {
        await this.paymentsService.processRefund((order as any).razorpayPaymentId, order.total, 'Customer return request');
      } catch (refundError: any) {
        this.logger.warn(`Failed to process Razorpay refund for return on order ${order._id}: ${refundError.message}`);
      }
    } else if (order.paymentMethod === 'paypal' || order.paymentMethod === 'cash_on_delivery') {
      // Non-Razorpay payments require manual admin refund processing.
      this.logger.log(`Return for order ${order._id} (${order.paymentMethod}): awaiting manual admin refund.`);
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

    // Update order statuses. For non-Razorpay payments, paymentStatus stays
    // 'pending' until an admin manually processes the refund.
    // assertOrderTransition already called above — skip duplicate call.
    order.status = 'refunded';
    if (order.paymentMethod === 'razorpay') {
      order.paymentStatus = 'refunded';
    }
    await order.save();

    // Confirm the return/refund to the customer. For non-Razorpay payments the
    // money moves once an admin processes it, but the return itself is accepted.
    this.notifyCustomerRefund(order._id, order.total, 'Customer return request');

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

    // Authorization check: admin can access any order; owning customer can access
    // their own order; sellers can access orders containing their line items (SO-4).
    if (userRole !== 'admin') {
      if (userRole === 'seller') {
        const sellerProducts = await this.productModel.find({ seller: userId }).select('_id').limit(10000).lean();
        const sellerProductIds = new Set(sellerProducts.map((p: any) => p._id.toString()));
        const hasSellerItem = (order.items as any[]).some((item: any) => sellerProductIds.has(item.product?.toString()));
        if (!hasSellerItem) {
          throw new BadRequestException('Not authorized');
        }
      } else {
        const customerId = this.extractCustomerId(order.customer);
        if (customerId !== userId) {
          throw new BadRequestException('Not authorized');
        }
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

    // Generate PDF invoice. Try Cloudinary first; fall back to returning
    // the raw buffer so the controller can stream it directly.
    let pdfUrl: string | null = null;
    let pdfBuffer: Buffer | null = null;
    try {
      const result = await this.pdfService.generateInvoiceWithBuffer(invoice);
      pdfUrl = result.url;
      if (!pdfUrl) pdfBuffer = result.buffer;
    } catch (error) {
      // PDF generation failed entirely — controller will return invoice
      // data only (no download link).
    }

    return {
      success: true,
      invoice,
      pdfUrl,
      pdfBuffer,
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
   * Credit a referrer their bonus points and stamp the referee as having used
   * a code. Fire-and-forget (via setImmediate) so a referral-bookkeeping
   * failure never rolls back or blocks a paid order. Called from two places:
   *   - order create, for COD/PayPal (immediate, non-deferred) orders, and
   *   - the Razorpay payment-success webhook, once payment is confirmed.
   * The referee stamp is guarded by `referralCodeUsed: { $exists: false }`, so
   * it's safe against the webhook firing more than once.
   */
  private creditReferral(referralCode: string, refereeUserId: string): void {
    setImmediate(async () => {
      try {
        const settingRow = await this.settingsModel.findOne({ key: 'referral.referrerBonusPts' }).lean() as any;
        const bonusPts = settingRow ? (parseInt(settingRow.value, 10) || 100) : 100;

        // Atomic increment so concurrent referral credits can't clobber each
        // other via read-then-write. `$inc` creates the nested referralStats
        // fields on first use, so no separate default-initialization is needed.
        await this.userModel.updateOne(
          { referralCode },
          {
            $inc: {
              loyaltyPoints: bonusPts,
              'referralStats.usedCount': 1,
              'referralStats.bonusEarned': bonusPts,
            },
          },
        );

        // Stamp the referee so they can't reuse another referral code.
        await this.userModel.updateOne(
          { _id: refereeUserId, referralCodeUsed: { $exists: false } },
          { $set: { referralCodeUsed: referralCode } },
        );
      } catch (refErr: any) {
        this.logger.warn(
          `Referral post-order processing failed for code ${referralCode}: ${refErr?.message || refErr}`,
        );
      }
    });
  }

  /**
   * Update order payment status by Razorpay order ID — called by webhook handler.
   */
  async updatePaymentStatusByRazorpayOrderId(
    razorpayOrderId: string,
    razorpayPaymentId: string | null,
    paymentStatus: 'paid' | 'failed' | 'refunded',
    orderStatus?: 'processing' | 'cancelled' | 'refunded',
  ) {
    const order = await this.orderModel.findOne({ razorpayOrderId });

    if (!order) {
      throw new NotFoundException('Order not found for Razorpay order ID');
    }

    // Idempotency: webhooks can fire more than once. Skip if we've already
    // applied the same paymentStatus, otherwise we'd e.g. re-clear the cart or
    // re-restore inventory on the second delivery of payment_intent.succeeded.
    if (order.paymentStatus === paymentStatus) {
      return { success: true, order };
    }

    const updateData: any = { paymentStatus };
    // Persist the payment ID from the webhook so refunds can use it later.
    if (razorpayPaymentId) {
      updateData.razorpayPaymentId = razorpayPaymentId;
    }
    if (orderStatus) {
      updateData.status = orderStatus;
    }
    if (paymentStatus === 'paid' && !orderStatus) {
      updateData.status = 'processing';
    }
    // Cancel the order atomically in the same write as the paymentStatus update
    // so there is no window where inventory is restored but status is still pending.
    if (paymentStatus === 'failed' && !orderStatus) {
      updateData.status = 'cancelled';
    }

    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      order._id,
      updateData,
      { new: true },
    );

    if (paymentStatus === 'paid') {
      // Now that payment is confirmed, clear the user's cart — and credit any
      // referral. For Razorpay the credit is deferred to here (order create
      // skips it because the cart-clear is deferred), so without this an online
      // payment would never credit the referrer or stamp the referee. Capture
      // the referral code BEFORE clearing the cart. The idempotency guard above
      // ensures this runs at most once per order.
      try {
        const cart = await this.cartModel.findOne({ user: order.customer });
        if (cart) {
          const referralCode = cart.referralCode;
          cart.items = [];
          cart.couponCode = undefined;
          cart.couponDiscount = undefined;
          cart.referralCode = undefined;
          cart.referralDiscount = undefined;
          await cart.save();
          if (referralCode) {
            this.creditReferral(referralCode, this.extractCustomerId(order.customer));
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to clear cart for order ${order._id} after payment success: ${err?.message || err}`,
        );
      }
      // Payment confirmed — let the customer know the order is now processing.
      this.notifyCustomerStatus(order._id);
    } else if (paymentStatus === 'failed') {
      // Payment failed — tell the customer the order was cancelled.
      setImmediate(async () => {
        try {
          const o = await this.orderModel.findById(order._id).populate('customer');
          const email = (o as any)?.customer?.email;
          if (email) await this.emailService.sendPaymentFailedEmail(email, o);
        } catch (err: any) {
          this.logger.warn(`Payment-failed email failed for order ${order._id}: ${err?.message || err}`);
        }
      });
      // Payment failed — release the inventory we reserved at order-create time.
      // Order status is already set to 'cancelled' in updateData above.
      try {
        await Promise.all(
          order.items.map((item: any) =>
            this.productModel.updateOne(
              { _id: item.product },
              { $inc: { inventory: item.quantity } },
            ),
          ),
        );
      } catch (err: any) {
        this.logger.warn(
          `Failed to release inventory for failed payment on order ${order._id}: ${err?.message || err}`,
        );
      }
    }

    return { success: true, order: updatedOrder };
  }

  async resendOrderEmail(orderId: string): Promise<{ success: boolean; message: string }> {
    const order = await this.orderModel.findById(orderId).populate('customer').lean();
    if (!order) throw new NotFoundException('Order not found');
    const email = (order as any).customer?.email;
    if (!email) return { success: false, message: 'Customer has no email address' };
    try {
      if ((order as any).status === 'delivered' || (order as any).status === 'refunded') {
        await this.emailService.sendOrderStatusUpdateEmail(email, order);
      } else {
        await this.emailService.sendOrderConfirmationEmail(email, order);
      }
      return { success: true, message: 'Order email resent successfully' };
    } catch (err: any) {
      throw new BadRequestException(`Failed to send email: ${err?.message || 'Unknown error'}`);
    }
  }
}

