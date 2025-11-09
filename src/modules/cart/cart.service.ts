import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cart, ICart } from '../../models/Cart.model';
import { Product, IProduct } from '../../models/Product.model';
import { Coupon, ICoupon } from '../../models/Coupon.model';
import { ExchangeRateService } from '../../services/exchange-rate.service';

@Injectable()
export class CartService {
  constructor(
    @InjectModel('Cart') private cartModel: Model<ICart>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Coupon') private couponModel: Model<ICoupon>,
    private exchangeRateService: ExchangeRateService,
  ) {}

  async getCart(userId: string, currency: string = 'INR') {
    let cart = await this.cartModel.findOne({ user: userId }).populate('items.product');

    if (!cart) {
      cart = await this.cartModel.create({ user: userId, items: [] });
    }

    // Convert currency to uppercase
    const currencyUpper = (currency || 'INR').toUpperCase() as 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY';

    // Calculate cart totals in base currency (INR)
    const subtotalBase = cart.items.reduce((total, item) => {
      const product = item.product as any;
      if (!product) return total;
      return total + product.price * item.quantity;
    }, 0);

    const taxBase = subtotalBase * 0.1; // 10% tax
    const shippingBase = subtotalBase > 0 ? 500 : 0; // ₹500 shipping if cart has items (in INR base currency)
    const discountBase = cart.couponDiscount || 0;
    const totalBase = subtotalBase + taxBase + shippingBase - discountBase;

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
        discount: discount, // Converted discount
      };
    }

    return {
      success: true,
      cart: cartObj,
    };
  }

  async addToCart(userId: string, productId: string, quantity: number, variants?: any) {
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

    await cart.save();
    await cart.populate('items.product');

    // Calculate cart totals
    const subtotal = cart.items.reduce((total, item) => {
      const product = item.product as any;
      if (!product) return total;
      return total + product.price * item.quantity;
    }, 0);

    const tax = subtotal * 0.1;
    const shipping = subtotal > 0 ? 10 : 0;
    const discount = cart.couponDiscount || 0;
    const total = subtotal + tax + shipping - discount;

    const cartObj = cart.toObject() as any;
    cartObj.subtotal = subtotal;
    cartObj.tax = tax;
    cartObj.shipping = shipping;
    cartObj.total = total;
    
    // Ensure items have _id fields
    if (cartObj.items) {
      cartObj.items = cartObj.items.map((item: any, index: number) => ({
        ...item,
        _id: item._id || cart.items[index]._id?.toString(),
      }));
    }
    
    if (cart.couponCode && cart.couponDiscount) {
      cartObj.coupon = {
        code: cart.couponCode,
        discount: cart.couponDiscount,
      };
    }

    return {
      success: true,
      cart: cartObj,
    };
  }

  async updateCartItem(userId: string, itemId: string, quantity: number) {
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

    await cart.save();
    await cart.populate('items.product');

    // Calculate cart totals
    const subtotal = cart.items.reduce((total, item) => {
      const product = item.product as any;
      if (!product) return total;
      return total + product.price * item.quantity;
    }, 0);

    const tax = subtotal * 0.1;
    const shipping = subtotal > 0 ? 10 : 0;
    const discount = cart.couponDiscount || 0;
    const total = subtotal + tax + shipping - discount;

    const cartObj = cart.toObject() as any;
    cartObj.subtotal = subtotal;
    cartObj.tax = tax;
    cartObj.shipping = shipping;
    cartObj.total = total;
    
    // Ensure items have _id fields
    if (cartObj.items) {
      cartObj.items = cartObj.items.map((item: any, index: number) => ({
        ...item,
        _id: item._id || cart.items[index]._id?.toString(),
      }));
    }
    
    if (cart.couponCode && cart.couponDiscount) {
      cartObj.coupon = {
        code: cart.couponCode,
        discount: cart.couponDiscount,
      };
    }

    return {
      success: true,
      cart: cartObj,
    };
  }

  async removeFromCart(userId: string, itemId: string) {
    const cart = await this.cartModel.findOne({ user: userId });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = cart.items.filter((item) => item._id?.toString() !== itemId);
    await cart.save();
    await cart.populate('items.product');

    // Calculate cart totals
    const subtotal = cart.items.reduce((total, item) => {
      const product = item.product as any;
      if (!product) return total;
      return total + product.price * item.quantity;
    }, 0);

    const tax = subtotal * 0.1;
    const shipping = subtotal > 0 ? 10 : 0;
    const discount = cart.couponDiscount || 0;
    const total = subtotal + tax + shipping - discount;

    const cartObj = cart.toObject() as any;
    cartObj.subtotal = subtotal;
    cartObj.tax = tax;
    cartObj.shipping = shipping;
    cartObj.total = total;
    
    // Ensure items have _id fields
    if (cartObj.items) {
      cartObj.items = cartObj.items.map((item: any, index: number) => ({
        ...item,
        _id: item._id || cart.items[index]._id?.toString(),
      }));
    }
    
    if (cart.couponCode && cart.couponDiscount) {
      cartObj.coupon = {
        code: cart.couponCode,
        discount: cart.couponDiscount,
      };
    }

    return {
      success: true,
      cart: cartObj,
    };
  }

  async clearCart(userId: string) {
    const cart = await this.cartModel.findOne({ user: userId });
    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    cart.items = [];
    await cart.save();

    return {
      success: true,
      message: 'Cart cleared',
    };
  }

  async applyCoupon(userId: string, code: string) {
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

    const cart = await this.cartModel.findOne({ user: userId }).populate('items.product');

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    // Calculate cart total
    const cartTotal = cart.items.reduce((total, item) => {
      const product = item.product as any;
      return total + product.price * item.quantity;
    }, 0);

    // Check minimum purchase
    if (coupon.minPurchase && cartTotal < coupon.minPurchase) {
      throw new BadRequestException(
        `Minimum purchase of ${coupon.minPurchase} required`
      );
    }

    // Calculate discount
    let discount = 0;
    if (coupon.type === 'percentage') {
      discount = (cartTotal * coupon.value) / 100;
      if (coupon.maxDiscount) {
        discount = Math.min(discount, coupon.maxDiscount);
      }
    } else {
      discount = coupon.value;
    }

    // Apply coupon to cart
    cart.couponCode = coupon.code;
    cart.couponDiscount = discount;
    await cart.save();
    await cart.populate('items.product');

    // Calculate cart totals
    const subtotal = cart.items.reduce((total, item) => {
      const product = item.product as any;
      if (!product) return total;
      return total + product.price * item.quantity;
    }, 0);

    const tax = subtotal * 0.1;
    const shipping = subtotal > 0 ? 10 : 0;
    const total = subtotal + tax + shipping - discount;

    const cartObj = cart.toObject() as any;
    cartObj.subtotal = subtotal;
    cartObj.tax = tax;
    cartObj.shipping = shipping;
    cartObj.total = total;
    
    // Ensure items have _id fields
    if (cartObj.items) {
      cartObj.items = cartObj.items.map((item: any, index: number) => ({
        ...item,
        _id: item._id || cart.items[index]._id?.toString(),
      }));
    }
    
    cartObj.coupon = {
      code: coupon.code,
      discount,
      type: coupon.type,
    };

    return {
      success: true,
      message: 'Coupon applied successfully',
      coupon: {
        code: coupon.code,
        discount,
        type: coupon.type,
      },
      cart: cartObj,
    };
  }
}

