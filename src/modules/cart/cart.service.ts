import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cart, ICart } from '../../models/Cart.model';
import { Product, IProduct } from '../../models/Product.model';
import { Coupon, ICoupon } from '../../models/Coupon.model';
import { ISettings } from '../../models/Settings.model';
import { ExchangeRateService } from '../../services/exchange-rate.service';

@Injectable()
export class CartService {
  constructor(
    @InjectModel('Cart') private cartModel: Model<ICart>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Coupon') private couponModel: Model<ICoupon>,
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
    private exchangeRateService: ExchangeRateService,
  ) {}

  private async getCartSettings(): Promise<{ taxRate: number; taxMethod: 'percentage' | 'fixed'; shippingFlat: number; freeShippingAbove: number }> {
    const rows = await this.settingsModel
      .find({ key: { $in: ['order.taxRate', 'order.taxMethod', 'order.shippingFlat', 'order.freeShippingAbove'] } })
      .lean();
    const map = new Map(rows.map(r => [r.key, r.value]));
    const taxMethodRaw = String(map.get('order.taxMethod') ?? 'percentage');
    return {
      taxRate:           Number(map.get('order.taxRate') ?? 0.18),
      taxMethod:         taxMethodRaw === 'fixed' ? 'fixed' : 'percentage',
      shippingFlat:      Number(map.get('order.shippingFlat') ?? 99),
      freeShippingAbove: Number(map.get('order.freeShippingAbove') ?? 499),
    };
  }

  private async recalculateCartDiscount(cart: ICart): Promise<void> {
    if (!cart.couponCode) {
      cart.couponDiscount = 0;
      return;
    }

    const coupon = await this.couponModel.findOne({
      code: cart.couponCode.toUpperCase(),
      status: 'active',
    });

    if (!coupon) {
      cart.couponCode = undefined;
      cart.couponDiscount = 0;
      return;
    }

    // Check if coupon is valid (time-wise)
    const now = new Date();
    if (now < coupon.validFrom || now > coupon.validUntil) {
      cart.couponCode = undefined;
      cart.couponDiscount = 0;
      return;
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      cart.couponCode = undefined;
      cart.couponDiscount = 0;
      return;
    }

    // Populate items.product if not already populated
    if (!cart.populated('items.product')) {
      await cart.populate('items.product');
    }

    // Calculate cart totals in base currency (INR)
    let eligibleSubtotal = 0;
    let totalSubtotal = 0;

    for (const item of cart.items) {
      const product = item.product as any;
      if (!product) continue;

      const itemPrice = product.price;
      const itemTotal = itemPrice * item.quantity;
      totalSubtotal += itemTotal;

      let isEligible = true;
      if (coupon.applicableProducts && coupon.applicableProducts.length > 0) {
        isEligible = coupon.applicableProducts.some(
          (pId) => pId.toString() === product._id.toString()
        );
      }
      if (isEligible && coupon.applicableCategories && coupon.applicableCategories.length > 0) {
        isEligible = coupon.applicableCategories.some(
          (cId) => cId.toString() === product.category?.toString()
        );
      }

      if (isEligible) {
        eligibleSubtotal += itemTotal;
      }
    }

    // Check minimum purchase. If cart drops below the threshold (e.g. user
    // removed items), silently remove the coupon. The cart response includes
    // `couponRemoved: true` so the client can show a toast.
    if (coupon.minPurchase && totalSubtotal < coupon.minPurchase) {
      cart.couponCode = undefined;
      cart.couponDiscount = 0;
      (cart as any).__couponRemovedReason = `Coupon removed: cart total is below the minimum purchase of ${coupon.minPurchase}`;
      return;
    }

    // Calculate discount in base currency
    let discount = 0;
    if (coupon.type === 'percentage') {
      discount = (eligibleSubtotal * coupon.value) / 100;
      if (coupon.maxDiscount) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      if (eligibleSubtotal > 0) {
        discount = Math.min(coupon.value, eligibleSubtotal);
      }
    }

    // Cap discount at totalSubtotal
    cart.couponDiscount = Math.min(discount, totalSubtotal);
  }

  async getCart(userId: string, currency: string = 'INR') {
    let cart = await this.cartModel.findOne({ user: userId }).populate('items.product');

    if (!cart) {
      cart = await this.cartModel.create({ user: userId, items: [] });
    }

    // Recalculate coupon discount to ensure it's up to date
    if (cart.couponCode) {
      const oldDiscount = cart.couponDiscount;
      const oldCode = cart.couponCode;
      await this.recalculateCartDiscount(cart);
      if (cart.couponDiscount !== oldDiscount || cart.couponCode !== oldCode) {
        await cart.save();
      }
    }

    // Convert currency to uppercase
    const currencyUpper = (currency || 'INR').toUpperCase() as 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY';

    // Calculate cart totals in base currency (INR)
    const subtotalBase = cart.items.reduce((total, item) => {
      const product = item.product as any;
      if (!product) return total;
      return total + product.price * item.quantity;
    }, 0);

    const { taxRate, taxMethod, shippingFlat, freeShippingAbove } = await this.getCartSettings();
    // Branch on taxMethod: 'percentage' multiplies the subtotal; 'fixed' is a flat charge.
    const taxBase = taxMethod === 'fixed' ? taxRate : subtotalBase * taxRate;
    const shippingBase = subtotalBase > freeShippingAbove ? 0 : subtotalBase > 0 ? shippingFlat : 0;
    const discountBase = cart.couponDiscount || 0;
    const totalBase = Math.max(0, subtotalBase + taxBase + shippingBase - discountBase);

    // Convert totals to requested currency
    const subtotal = this.exchangeRateService.convertToCurrency(subtotalBase, currencyUpper);
    const tax = this.exchangeRateService.convertToCurrency(taxBase, currencyUpper);
    const shipping = this.exchangeRateService.convertToCurrency(shippingBase, currencyUpper);
    const discount = this.exchangeRateService.convertToCurrency(discountBase, currencyUpper);
    const total = this.exchangeRateService.convertToCurrency(totalBase, currencyUpper);

    // Convert cart to plain object and add calculated fields
    const cartObj = cart.toObject() as any;
    cartObj.subtotal = subtotal;
    cartObj.tax = tax;
    cartObj.shipping = shipping;
    cartObj.discount = discount;
    cartObj.total = total;
    cartObj.currency = currencyUpper;
    
    // Convert product prices in items
    if (cartObj.items) {
      cartObj.items = cartObj.items.map((item: any, index: number) => {
        const product = item.product as any;
        if (product) {
          return {
            ...item,
            _id: item._id || cart.items[index]._id?.toString(),
            product: {
              ...product,
              price: this.exchangeRateService.convertToCurrency(product.price, currencyUpper),
              compareAtPrice: product.compareAtPrice 
                ? this.exchangeRateService.convertToCurrency(product.compareAtPrice, currencyUpper)
                : undefined,
            },
          };
        }
        return {
          ...item,
          _id: item._id || cart.items[index]._id?.toString(),
        };
      });
    }
    
    if (cart.couponCode && cart.couponDiscount) {
      cartObj.coupon = {
        code: cart.couponCode,
        discount: discount,
      };
    }

    const couponRemovedReason = (cart as any).__couponRemovedReason;

    return {
      success: true,
      cart: cartObj,
      ...(couponRemovedReason ? { couponRemoved: true, couponRemovedReason } : {}),
    };
  }

  async addToCart(userId: string, productId: string, quantity: number, variants?: any, currency: string = 'INR') {
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be a positive integer');
    }

    const product = await this.productModel.findById(productId);
    if (!product || product.status !== 'approved') {
      throw new BadRequestException('Product not available');
    }

    if (product.inventory < quantity) {
      throw new BadRequestException('Insufficient inventory');
    }

    let cart = await this.cartModel.findOne({ user: userId });

    if (!cart) {
      cart = await this.cartModel.create({
        user: userId,
        items: [],
      });
    }

    // Check if item already exists
    const existingItemIndex = cart.items.findIndex(
      (item) =>
        item.product.toString() === productId &&
        JSON.stringify(item.variants) === JSON.stringify(variants || {})
    );

    if (existingItemIndex > -1) {
      cart.items[existingItemIndex].quantity += quantity;
    } else {
      cart.items.push({
        product: productId as any,
        quantity,
        variants: variants || {},
      });
    }

    await this.recalculateCartDiscount(cart);
    await cart.save();
    return this.getCart(userId, currency);
  }

  async updateCartItem(userId: string, itemId: string, quantity: number, currency: string = 'INR') {
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) {
      throw new BadRequestException('Quantity must be a non-negative integer');
    }

    const cart = await this.cartModel.findOne({ user: userId });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    const item = cart.items.find((item) => item._id?.toString() === itemId);
    if (!item) {
      throw new NotFoundException('Item not found in cart');
    }

    if (quantity <= 0) {
      cart.items = cart.items.filter((item) => item._id?.toString() !== itemId);
    } else {
      item.quantity = quantity;
    }

    await this.recalculateCartDiscount(cart);
    await cart.save();
    return this.getCart(userId, currency);
  }

  async removeFromCart(userId: string, itemId: string, currency: string = 'INR') {
    const cart = await this.cartModel.findOne({ user: userId });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = cart.items.filter((item) => item._id?.toString() !== itemId);
    await this.recalculateCartDiscount(cart);
    await cart.save();
    return this.getCart(userId, currency);
  }

  async clearCart(userId: string) {
    const cart = await this.cartModel.findOne({ user: userId });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = [];
    cart.couponCode = undefined;
    cart.couponDiscount = undefined;
    await cart.save();

    return {
      success: true,
      message: 'Cart cleared',
    };
  }

  async applyCoupon(userId: string, code: string, currency: string = 'INR') {
    if (!code) {
      throw new BadRequestException('Coupon code is required');
    }

    const coupon = await this.couponModel.findOne({
      code: code.toUpperCase(),
      status: 'active',
    });

    if (!coupon) {
      throw new BadRequestException('Invalid coupon code');
    }

    // Check if coupon is valid
    const now = new Date();
    if (now < coupon.validFrom || now > coupon.validUntil) {
      throw new BadRequestException('Coupon has expired');
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('Coupon usage limit reached');
    }

    const cart = await this.cartModel.findOne({ user: userId });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Calculate cart total
    await cart.populate('items.product');
    const cartTotal = cart.items.reduce((total, item) => {
      const product = item.product as any;
      if (!product) return total;
      return total + product.price * item.quantity;
    }, 0);

    // Check minimum purchase
    if (coupon.minPurchase && cartTotal < coupon.minPurchase) {
      throw new BadRequestException(
        `Minimum purchase of ${coupon.minPurchase} required`
      );
    }

    // Apply coupon to cart
    cart.couponCode = coupon.code;
    await this.recalculateCartDiscount(cart);

    if (!cart.couponDiscount || cart.couponDiscount === 0) {
      cart.couponCode = undefined;
      cart.couponDiscount = 0;
      await cart.save();
      throw new BadRequestException(
        'This coupon is not applicable to the items in your cart.'
      );
    }

    await cart.save();
    return this.getCart(userId, currency);
  }
}

