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
import { IDeliverySlot } from '../../models/DeliverySlot.model';
import { ILoyaltyTransaction } from '../../models/LoyaltyTransaction.model';
import { IIdempotencyKey } from '../../models/IdempotencyKey.model';
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
    @InjectModel('DeliverySlot') private deliverySlotModel: Model<IDeliverySlot>,
    @InjectModel('LoyaltyTransaction') private loyaltyTxModel: Model<ILoyaltyTransaction>,
    @InjectModel('IdempotencyKey') private idempotencyKeyModel: Model<IIdempotencyKey>,
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
   * Read loyalty-program settings from the Settings collection. Mirrors
   * LoyaltyService.getSettings (same keys / category / defaults) so loyalty
   * redemption can be validated and applied inside the order-create
   * transaction without a cross-module call. Kept in sync intentionally.
   */
  private async getLoyaltySettings(): Promise<{
    redemptionRate: number;
    minRedemptionPoints: number;
    maxRedemptionPercent: number;
  }> {
    const docs = await this.settingsModel.find({ category: 'loyalty' }).lean();
    const map: Record<string, any> = {};
    for (const doc of docs as any[]) map[doc.key] = doc.value;
    const redemptionRate = Number(map['loyalty.redemptionRate'] ?? 0.1);
    const minRedemptionPoints = Number(map['loyalty.minRedemptionPoints'] ?? 100);
    const maxRedemptionPercent = Number(map['loyalty.maxRedemptionPercent'] ?? 50);
    return {
      redemptionRate: Number.isFinite(redemptionRate) && redemptionRate >= 0 ? redemptionRate : 0.1,
      minRedemptionPoints: Number.isFinite(minRedemptionPoints) && minRedemptionPoints > 0 ? minRedemptionPoints : 100,
      maxRedemptionPercent:
        Number.isFinite(maxRedemptionPercent) && maxRedemptionPercent >= 0 && maxRedemptionPercent <= 100
          ? maxRedemptionPercent
          : 50,
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

  async create(userId: string, orderData: any, idempotencyKey?: string) {
    // SERVER-SIDE IDEMPOTENCY: when the client supplies an Idempotency-Key
    // header, a network retry must NOT create a second order. We reserve the
    // key up-front (unique index on key+user+scope); if the key already exists
    // we return the order it produced the first time. The reservation row is
    // stamped with the orderId once creation succeeds, and deleted if creation
    // fails so the client can retry with the same key.
    const key = (idempotencyKey || '').trim();
    if (key) {
      let reservation: IIdempotencyKey | null = null;
      try {
        reservation = await this.idempotencyKeyModel.create({
          key,
          user: userId,
          scope: 'order-create',
        });
      } catch (err: any) {
        if (err?.code === 11000) {
          // Key already used — return the previously-created order. (If the
          // first request is still in flight / failed without stamping an
          // orderId, surface a clear conflict instead of a silent duplicate.)
          const existing = await this.idempotencyKeyModel.findOne({
            key,
            user: userId,
            scope: 'order-create',
          });
          if (existing?.orderId) {
            const prior = await this.orderModel.findById(existing.orderId);
            if (prior) {
              return { success: true, order: this.convertOrderCurrency(prior) };
            }
          }
          throw new BadRequestException(
            'A request with this Idempotency-Key is already being processed. Please retry shortly.',
          );
        }
        throw err;
      }

      try {
        const result = await this._create(userId, orderData);
        // Stamp the created order onto the reservation so retries resolve to it.
        await this.idempotencyKeyModel.updateOne(
          { _id: reservation._id },
          { $set: { orderId: result.order._id } },
        );
        return result;
      } catch (err) {
        // Creation failed — release the key so the client can retry cleanly.
        await this.idempotencyKeyModel.deleteOne({ _id: reservation._id }).catch(() => undefined);
        throw err;
      }
    }

    return this._create(userId, orderData);
  }

  /**
   * Core order-creation wrapped in a MongoDB session so inventory decrements,
   * coupon redemption, address creation, and order insert are all atomic. If
   * any step fails the session aborts and all writes are rolled back — no
   * stranded reservations or orphaned coupons.
   * Note: transactions require a replica set (or Atlas). On standalone MongoDB
   * (local dev) the session is opened but transactions aren't enforced — the
   * rollback logic below handles that case manually.
   */
  private async _create(userId: string, orderData: any) {
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
    // ALWAYS load the user's server cart — it is the source of truth for the
    // coupon/referral codes and their discounts. The previous code only loaded
    // the cart when the client sent no items, so a checkout that POSTed `items`
    // (the web flow always does) silently dropped any applied coupon/referral
    // discount: the customer saw a discounted total in the UI but was charged
    // the full amount, and the cart was never cleared on success. Loading the
    // cart unconditionally keeps pricing server-authoritative.
    const cart: any = await this.cartModel
      .findOne({ user: userId })
      .populate('items.product')
      .session(session);

    // Use cart items from orderData if provided, otherwise fall back to the
    // server cart. (Line items / quantities are still taken from the request
    // when present; price/seller are always re-read from the DB below.)
    let itemsToProcess = orderData.items;
    if (!itemsToProcess || itemsToProcess.length === 0) {
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
    // product.price on qualifying items. The pre-fetch is only a candidate list —
    // the actual sale-stock reservation below is done with a conditional, atomic
    // findOneAndUpdate inside the session so concurrent orders cannot oversell.
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
      .session(session)
      .lean();
    // Build a map productId -> flash sale so per-item lookup is O(1).
    const flashSaleByProduct = new Map<string, any>();
    for (const fs of activeFlashSales) {
      flashSaleByProduct.set(fs.product.toString(), fs);
    }
    // Track flash-sale soldCount reservations we made inside the session, so we
    // can roll them back if a later step in order creation fails.
    const reservedFlashSales: Array<{ id: string; qty: number }> = [];

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

        // Apply flash-sale price ONLY if we can atomically reserve flash-sale
        // stock for this quantity. We conditionally $inc soldCount inside the
        // session: the filter requires either an unlimited sale (stockLimit 0)
        // or that soldCount + qty would not exceed stockLimit. If the update
        // returns null the sale is exhausted/expired right now, so we fall back
        // to the product's normal price and charge the regular amount.
        const candidate = flashSaleByProduct.get(product._id.toString());
        let effectivePrice = product.price;
        if (candidate) {
          const reservedFs = await this.flashSaleModel.findOneAndUpdate(
            {
              _id: candidate._id,
              isActive: true,
              startTime: { $lte: flashSaleNow },
              endTime: { $gt: flashSaleNow },
              $or: [
                { stockLimit: 0 },
                { $expr: { $lte: [{ $add: ['$soldCount', item.quantity] }, '$stockLimit'] } },
              ],
            },
            { $inc: { soldCount: item.quantity } },
            { new: true, session },
          );
          if (reservedFs) {
            effectivePrice = candidate.salePrice;
            reservedFlashSales.push({ id: candidate._id.toString(), qty: item.quantity });
          }
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
      await Promise.all([
        ...reserved.map((r) =>
          this.productModel.updateOne(
            { _id: r.productId },
            { $inc: { inventory: r.quantity } },
            { session },
          ),
        ),
        ...reservedFlashSales.map((fs) =>
          this.flashSaleModel.updateOne(
            { _id: fs.id },
            { $inc: { soldCount: -fs.qty } },
            { session },
          ),
        ),
      ]);
      throw err;
    }

    // Loyalty redemption applied to this order (deducted atomically inside the
    // session below, after subtotal/tax/shipping/discount are known). Declared
    // before restoreReservations so the rollback closure can capture it.
    let loyaltyDiscount = 0;
    let loyaltyPointsRedeemed = 0;

    // Helper: roll back any inventory + flash-sale + loyalty reservations made
    // above. Used in catches below so downstream failures don't leave stranded
    // reserved stock or burned loyalty points.
    const restoreReservations = async () => {
      await Promise.all([
        ...reserved.map((r) =>
          this.productModel.updateOne(
            { _id: r.productId },
            { $inc: { inventory: r.quantity } },
            { session },
          ),
        ),
        ...reservedFlashSales.map((fs) =>
          this.flashSaleModel.updateOne(
            { _id: fs.id },
            { $inc: { soldCount: -fs.qty } },
            { session },
          ),
        ),
      ]);
      // Restore any loyalty points we deducted for this order.
      if (loyaltyPointsRedeemed > 0) {
        await this.userModel.updateOne(
          { _id: userId },
          { $inc: { loyaltyPoints: loyaltyPointsRedeemed } },
          { session },
        );
      }
    };

    // Branch on taxMethod: 'percentage' multiplies the subtotal; 'fixed' adds a flat charge.
    const tax = taxMethod === 'fixed' ? taxRate : subtotal * taxRate;
    let shipping = subtotal > 0 && subtotal < freeShippingAbove ? shippingFlat : 0;
    let discount = 0;
    let total = 0;
    // Delivery slot is resolved inside the try below; its extraCharge (if any)
    // is folded into `shipping` BEFORE the total is computed so the customer is
    // charged the fee they were shown.
    let deliverySlotId: any = undefined;
    let deliverySlotLabel: string | undefined = undefined;

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

      // Resolve the delivery slot (if provided) BEFORE computing the total so
      // its extraCharge is included in what the customer is charged. The slot's
      // fee is folded into `shipping` so it surfaces in the order's shipping
      // line and matches the checkout summary.
      if (orderData.deliverySlotId) {
        const slot = await this.deliverySlotModel.findById(orderData.deliverySlotId).session(session);
        if (slot) {
          deliverySlotId = slot._id;
          deliverySlotLabel = slot.label;
          const extraCharge = Number((slot as any).extraCharge) || 0;
          if (extraCharge > 0) shipping += extraCharge;
        }
      }

      // Pre-loyalty total. Loyalty points (if redeemed) are applied on top of
      // this so the customer actually pays less for the points they burn.
      const totalBeforeLoyalty = Math.max(0, subtotal + tax + shipping - discount);

      // Loyalty redemption — done HERE inside the order-create transaction so the
      // points are deducted atomically with the order and actually reduce the
      // total the customer pays (the standalone /loyalty/redeem endpoint could
      // burn points without ever applying them to an order). The conditional
      // $inc with a $gte guard closes the TOCTOU window: two concurrent orders
      // can't both pass a stale balance check and overdraw the account.
      const requestedPoints = Number(orderData.pointsToRedeem);
      if (orderData.pointsToRedeem !== undefined && orderData.pointsToRedeem !== null) {
        if (!Number.isFinite(requestedPoints) || requestedPoints <= 0 || !Number.isInteger(requestedPoints)) {
          throw new BadRequestException('pointsToRedeem must be a positive integer');
        }
        const loyaltySettings = await this.getLoyaltySettings();
        if (requestedPoints < loyaltySettings.minRedemptionPoints) {
          throw new BadRequestException(
            `Minimum redemption is ${loyaltySettings.minRedemptionPoints} points`,
          );
        }

        // Rupee value of the requested points, capped at the configured
        // max-redemption percentage of the (pre-loyalty) order total and at the
        // total itself so points can never make the order negative.
        const rawValue = requestedPoints * loyaltySettings.redemptionRate;
        const maxByPercent = totalBeforeLoyalty * (loyaltySettings.maxRedemptionPercent / 100);
        loyaltyDiscount = Number(Math.min(rawValue, maxByPercent, totalBeforeLoyalty).toFixed(2));

        // Only the points whose value is actually applied are charged to the
        // customer's balance (capping may reduce the effective points).
        loyaltyPointsRedeemed =
          loyaltyDiscount < rawValue && loyaltySettings.redemptionRate > 0
            ? Math.ceil(loyaltyDiscount / loyaltySettings.redemptionRate)
            : requestedPoints;

        if (loyaltyPointsRedeemed > 0) {
          // Conditional atomic decrement — only succeeds if the balance is still
          // >= the points we intend to deduct at write time.
          const deducted = await this.userModel.findOneAndUpdate(
            { _id: userId, loyaltyPoints: { $gte: loyaltyPointsRedeemed } },
            { $inc: { loyaltyPoints: -loyaltyPointsRedeemed } },
            { new: true, session },
          ).select('loyaltyPoints');
          if (!deducted) {
            // Reset so restoreReservations (outer catch) doesn't re-credit points
            // that were never deducted.
            loyaltyPointsRedeemed = 0;
            loyaltyDiscount = 0;
            throw new BadRequestException('Insufficient loyalty points');
          }
        } else {
          loyaltyDiscount = 0;
        }
      }

      total = Math.max(0, totalBeforeLoyalty - loyaltyDiscount);

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
        loyaltyDiscount,
        loyaltyPointsRedeemed,
        total,
        couponCode: cart?.couponCode,
        razorpayOrderId: orderData.razorpayOrderId,
        razorpayPaymentId: orderData.razorpayPaymentId,
        status: 'pending',
        paymentStatus: 'pending',
        ...(deliverySlotId ? { deliverySlot: deliverySlotId, deliverySlotLabel } : {}),
      }], { session });
      order = createdOrder;

      // Record the loyalty redemption transaction inside the same session so the
      // ledger stays consistent with the deducted balance and the order.
      if (loyaltyPointsRedeemed > 0) {
        const balanceUser = await this.userModel.findById(userId).select('loyaltyPoints').session(session).lean();
        await this.loyaltyTxModel.create([{
          user: userId,
          points: loyaltyPointsRedeemed,
          type: 'redeem',
          description: `Redeemed for ₹${loyaltyDiscount} discount on order ${orderNumber}`,
          orderId: order._id,
          balanceAfter: (balanceUser as any)?.loyaltyPoints ?? 0,
        }], { session });
      }
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
    //  - razorpay PRE-payment (web): payment isn't complete yet. Defer the
    //    cart-clear until payment is confirmed so the user doesn't lose their
    //    cart if payment fails. The web flow stamps razorpayOrderId AFTER order
    //    create (via attachRazorpayOrderId) and the payment-success webhook /
    //    post-verify clearCart handle the actual clear. We therefore defer for
    //    ANY razorpay order that wasn't already confirmed inline (no
    //    razorpayPaymentId in the create body), NOT just ones that arrived with
    //    a razorpayOrderId.
    //  - razorpay POST-payment (mobile): create body carries razorpayPaymentId
    //    (+ verified signature) — payment is already confirmed, so clear now.
    //  - paypal: clear now until PayPal sync confirmation is wired up.
    const deferCartClear =
      order.paymentMethod === 'razorpay' && !orderData.razorpayPaymentId;

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

    // Flash-sale soldCount is already reserved atomically inside the order
    // transaction above (reservedFlashSales), so there is no best-effort
    // post-commit increment here — that would double-count.

    return {
      success: true,
      order: this.convertOrderCurrency(order),
    };
  }

  /**
   * Server-authoritative Razorpay amount for an order. Returns the persisted
   * Order.total (already in the order's stored base currency) plus the order's
   * currency, so the Razorpay order is created from the amount the server
   * actually computed — never from a client-supplied cart total. The caller
   * (payments create-order) must use these values verbatim.
   *
   * Throws if the order doesn't exist, doesn't belong to the user, or is no
   * longer payable (already paid / cancelled / refunded).
   */
  async getRazorpayAmountForOrder(
    orderId: string,
    userId: string,
  ): Promise<{ amount: number; currency: string; razorpayOrderId?: string }> {
    const order = await this.orderModel.findById(orderId).lean();
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (this.extractCustomerId(order.customer) !== userId) {
      throw new BadRequestException('Not authorized');
    }
    if (order.paymentStatus === 'paid') {
      throw new BadRequestException('Order is already paid');
    }
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw new BadRequestException('Order is no longer payable');
    }
    // Order.total is stored in the platform base currency; the customer is
    // charged in the order's display currency at the FX rate captured when the
    // order was placed. Apply exchangeRate so the gateway amount matches the
    // displayed total (for INR/base orders exchangeRate is 1, so this is a
    // no-op).
    const rate = Number(order.exchangeRate) || 1;
    const displayAmount = Number(((Number(order.total) || 0) * rate).toFixed(2));
    return {
      amount: displayAmount,
      currency: order.currency || 'INR',
      razorpayOrderId: (order as any).razorpayOrderId || undefined,
    };
  }

  /**
   * Persist the Razorpay gateway order id onto our Order so the payment webhook
   * (which only knows the Razorpay order id) can later match it and flip the
   * order to paid. Web checkout creates the Razorpay order AFTER the DB order,
   * then calls this to stamp the linkage. Idempotent — re-stamping the same id
   * is a no-op; a different id is rejected to avoid hijacking a paid order.
   */
  async attachRazorpayOrderId(
    orderId: string,
    userId: string,
    razorpayOrderId: string,
  ): Promise<{ success: boolean }> {
    if (!razorpayOrderId) {
      throw new BadRequestException('razorpayOrderId is required');
    }
    const order = await this.orderModel.findById(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (this.extractCustomerId(order.customer) !== userId) {
      throw new BadRequestException('Not authorized');
    }
    // Once paid we must never re-point the linkage (would let a second gateway
    // order hijack a settled order). While still unpaid, re-linking to a fresh
    // gateway order is allowed — e.g. the customer retried payment after the
    // first attempt failed/was abandoned, producing a new Razorpay order id.
    if (order.paymentStatus === 'paid') {
      if (order.razorpayOrderId && order.razorpayOrderId !== razorpayOrderId) {
        throw new BadRequestException('Order is already paid');
      }
      return { success: true };
    }
    if (order.razorpayOrderId !== razorpayOrderId) {
      order.razorpayOrderId = razorpayOrderId;
      await order.save();
    }
    return { success: true };
  }

  /**
   * Confirm-time amount guard. Looks up the order linked to the given Razorpay
   * order id and returns the expected amount (in the smallest currency unit,
   * i.e. paise) and currency so the payments service can assert the gateway
   * charged exactly what we recorded. Returns null when no order is linked yet
   * (e.g. mobile post-payment flow that stamps the order afterwards).
   */
  async getExpectedPaymentAmount(
    razorpayOrderId: string,
  ): Promise<{ amountInSmallestUnit: number; currency: string } | null> {
    const order = await this.orderModel.findOne({ razorpayOrderId }).lean();
    if (!order) return null;
    // Match the display-currency amount the gateway order was created with
    // (Order.total is in base currency; apply the captured FX rate). Compute
    // the smallest-currency-unit amount the SAME way the gateway did
    // (Math.round(displayAmount * 100)) so the equality check is exact.
    const rate = Number(order.exchangeRate) || 1;
    const displayAmount = Number(((Number(order.total) || 0) * rate).toFixed(2));
    return {
      amountInSmallestUnit: Math.round(displayAmount * 100),
      currency: (order.currency || 'INR').toUpperCase(),
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

    // For sellers, remember their product ids so we can both authorize AND
    // strip other sellers' line items from the response below.
    let sellerProductIds: Set<string> | null = null;

    if (userRole === 'admin') {
      // Admin can view any order — no further check needed.
    } else if (userRole === 'seller') {
      // Sellers may only view orders that contain at least one of their products.
      const sellerProducts = await this.productModel
        .find({ seller: userId })
        .select('_id')
        .lean();
      sellerProductIds = new Set(sellerProducts.map((p: any) => p._id.toString()));
      const hasSellerItem = (order.items as any[]).some((item: any) => {
        const pid = item.seller?.toString() ?? item.product?.toString();
        return pid && sellerProductIds!.has(pid);
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

    // For a seller, strip out line items that don't belong to them. A
    // multi-seller order must NOT leak other sellers' products, prices, or
    // earnings. Mirrors seller.service.getOrderById's productIdSet filtering.
    if (userRole === 'seller' && sellerProductIds && convertedOrder.items) {
      convertedOrder.items = (convertedOrder.items as any[]).filter((item: any) => {
        const pid = item.seller?.toString() ?? item.product?._id?.toString() ?? item.product?.toString();
        return pid && sellerProductIds!.has(pid);
      });
    }

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

  /**
   * Single entry point for issuing a refund against an order. ALL refund paths
   * (orders.cancel, orders.requestReturn, disputes.resolve) must route through
   * here so refunds can never double-pay.
   *
   * Behaviour:
   *  - Reads the order's cumulative `refundedAmount` and computes the remaining
   *    refundable balance (`total - refundedAmount`).
   *  - If `amount` is omitted it defaults to the full remaining balance.
   *  - Rejects non-positive / NaN amounts and amounts above the remaining
   *    balance, so the order can never be refunded for more than its total.
   *  - Calls Razorpay (when applicable) for the clamped amount, then increments
   *    `refundedAmount` by what was actually refunded.
   *  - Flips `paymentStatus` to 'refunded' ONLY once the order is fully
   *    refunded; partial refunds leave paymentStatus as-is.
   *
   * The caller is responsible for the order-level status transition
   * (assertOrderTransition + setting order.status) and for persisting via save();
   * this method mutates the in-memory document and returns the amount refunded.
   */
  private async issueRefund(
    order: IOrder,
    amount: number | undefined,
    reason: string,
  ): Promise<number> {
    const total = Number(order.total) || 0;
    const alreadyRefunded = Number(order.refundedAmount) || 0;
    const remaining = Number((total - alreadyRefunded).toFixed(2));

    if (remaining <= 0 || order.paymentStatus === 'refunded') {
      throw new BadRequestException('Order has already been fully refunded');
    }

    // Default to the full remaining balance when no amount is specified.
    let refundAmount = amount === undefined || amount === null ? remaining : Number(amount);

    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      throw new BadRequestException('Refund amount must be a positive number');
    }
    if (refundAmount > remaining + 1e-6) {
      throw new BadRequestException(
        `Refund amount (${refundAmount}) exceeds the remaining refundable balance (${remaining})`,
      );
    }
    refundAmount = Number(refundAmount.toFixed(2));

    // Process the gateway refund for Razorpay orders that have actually been
    // paid. Other payment methods (COD/PayPal) require manual settlement, but we
    // still record the refundedAmount so the math stays correct.
    if (order.paymentMethod === 'razorpay' && (order as any).razorpayPaymentId && order.paymentStatus === 'paid') {
      await this.paymentsService.processRefund((order as any).razorpayPaymentId, refundAmount, reason);
    }

    const newRefunded = Number((alreadyRefunded + refundAmount).toFixed(2));
    order.refundedAmount = newRefunded;

    // Only mark the payment fully refunded once the cumulative refund reaches
    // the order total (within a cent of rounding tolerance).
    if (newRefunded >= total - 1e-6) {
      order.paymentStatus = 'refunded';
    }

    return refundAmount;
  }

  /**
   * Public refund entry point for the disputes flow (admin dispute resolution).
   * Loads the order, enforces the order state machine, routes the money through
   * the shared issueRefund helper (which respects refundedAmount and can never
   * double-refund), updates the order status to 'refunded' when fully refunded,
   * and persists. Returns the amount actually refunded plus the saved order.
   */
  async refundOrderForDispute(
    orderId: string,
    amount: number | undefined,
    reason: string,
  ): Promise<{ refundedAmount: number; order: IOrder }> {
    const order = await this.orderModel.findById(orderId);
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Short-circuit if the order is already fully refunded — never re-refund.
    if (order.paymentStatus === 'refunded') {
      throw new BadRequestException('Order has already been refunded');
    }

    const refunded = await this.issueRefund(order, amount, reason);

    // Flip the order status to 'refunded' only once the order is fully
    // refunded; partial refunds keep the order in its current fulfilment state.
    // (issueRefund may have just set paymentStatus to 'refunded'; read it as a
    // string so TS doesn't narrow it away based on the guard above.)
    const paymentStatusAfter: string = order.paymentStatus;
    if (paymentStatusAfter === 'refunded' && order.status !== 'refunded') {
      assertOrderTransition(order.status, 'refunded');
      order.status = 'refunded';
    }

    await order.save();

    // Notify the customer of the refund. Best-effort.
    this.notifyCustomerRefund(order._id, refunded, reason);

    return { refundedAmount: refunded, order };
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

    // Process refund via the shared helper so refundedAmount is respected and
    // we can never double-refund. Only attempt for paid Razorpay orders that
    // aren't already fully refunded; a gateway failure is logged, not fatal.
    if (
      order.paymentMethod === 'razorpay' &&
      (order as any).razorpayPaymentId &&
      order.paymentStatus === 'paid'
    ) {
      try {
        await this.issueRefund(order, undefined, 'Order cancellation');
      } catch (refundError: any) {
        this.logger.warn(`Failed to process refund for cancellation on order ${order._id}: ${refundError.message}`);
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

    // Process refund based on payment method, routed through the shared
    // issueRefund helper so refundedAmount is respected and we can never
    // double-refund.
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
        // Full remaining balance (undefined amount). issueRefund flips
        // paymentStatus to 'refunded' once fully refunded.
        await this.issueRefund(order, undefined, 'Customer return request');
      } catch (refundError: any) {
        this.logger.warn(`Failed to process refund for return on order ${order._id}: ${refundError.message}`);
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

    // Update order status. For non-Razorpay payments, paymentStatus stays
    // 'pending' until an admin manually processes the refund (issueRefund only
    // flips it for paid Razorpay orders).
    // assertOrderTransition already called above — skip duplicate call.
    order.status = 'refunded';
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

    // For sellers, verify they own at least one product in this order. Mirrors
    // generateInvoice — without this any authenticated seller could pull the
    // shipping label (and the customer's full delivery address) for ANY order.
    if (userRole === 'seller') {
      const products = await this.productModel.find({ seller: userId }).select('_id').lean();
      const productIds = products.map((p: any) => p._id.toString());
      const orderHasSellerProducts = (order.items as any[]).some((item: any) => {
        const itemProductId = typeof item.product === 'object' && item.product !== null
          ? item.product._id?.toString()
          : item.product?.toString();
        const sellerId = item.seller?.toString();
        return productIds.includes(itemProductId) || (sellerId && sellerId === userId);
      });

      if (!orderHasSellerProducts) {
        throw new BadRequestException('Not authorized to view this order');
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

        // Stamp the referee FIRST, atomically, guarded by `referralCodeUsed`
        // not yet existing. This single update is the precondition that decides
        // whether the referrer earns the bonus, so a duplicate webhook (or any
        // concurrent re-run) can stamp at most once and thus credit at most once.
        const stamp = await this.userModel.updateOne(
          { _id: refereeUserId, referralCodeUsed: { $exists: false } },
          { $set: { referralCodeUsed: referralCode } },
        );

        // Only credit the referrer if WE were the call that stamped the referee.
        // modifiedCount === 0 means it was already stamped (self-referral guard
        // upstream, or a prior/duplicate run), so skip to avoid double-crediting.
        if (stamp.modifiedCount > 0) {
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
        }
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

