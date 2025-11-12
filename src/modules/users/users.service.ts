import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, IUser } from '../../models/User.model';
import { Address, IAddress } from '../../models/Address.model';
import { PaymentMethod, IPaymentMethod } from '../../models/PaymentMethod.model';
import { Product, IProduct } from '../../models/Product.model';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Address') private addressModel: Model<IAddress>,
    @InjectModel('PaymentMethod') private paymentMethodModel: Model<IPaymentMethod>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    private paymentsService: PaymentsService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      success: true,
      user,
    };
  }

  async updateProfile(userId: string, updateData: Partial<IUser>) {
    const user = await this.userModel.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,  
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      success: true,
      user,
    };
  }

  async getAddresses(userId: string) {
    const addresses = await this.addressModel.find({ user: userId });
    // Map backend fields to frontend format
    const mappedAddresses = addresses.map((addr: any) => ({
      _id: addr._id,
      fullName: `${addr.firstName} ${addr.lastName}`,
      address: addr.addressLine1,
      addressLine2: addr.addressLine2,
      city: addr.city,
      state: addr.state,
      postalCode: addr.zipCode,
      country: addr.country,
      phone: addr.phone,
      isDefault: addr.isDefault,
      type: addr.type,
    }));
    return {
      success: true,
      addresses: mappedAddresses,
    };
  }

  async addAddress(userId: string, addressData: any) {
    // Map frontend format (fullName, address, postalCode) to backend format (firstName, lastName, addressLine1, zipCode)
    let firstName = '';
    let lastName = '';
    if (addressData.fullName) {
      const nameParts = addressData.fullName.trim().split(' ');
      firstName = nameParts[0] || '';
      lastName = nameParts.slice(1).join(' ') || firstName;
    } else {
      firstName = addressData.firstName || '';
      lastName = addressData.lastName || '';
    }

    const address = await this.addressModel.create({
      user: userId,
      type: addressData.type || 'shipping',
      firstName,
      lastName,
      addressLine1: addressData.address || addressData.addressLine1 || '',
      addressLine2: addressData.addressLine2 || '',
      city: addressData.city || '',
      state: addressData.state || '',
      zipCode: addressData.postalCode || addressData.zipCode || '',
      country: addressData.country || 'United States',
      phone: addressData.phone || '',
      isDefault: addressData.isDefault || false,
    });
    return {
      success: true,
      address: {
        _id: address._id,
        fullName: `${address.firstName} ${address.lastName}`,
        address: address.addressLine1,
        city: address.city,
        state: address.state,
        postalCode: address.zipCode,
        country: address.country,
        phone: address.phone,
        isDefault: address.isDefault,
      },
    };
  }

  async updateAddress(userId: string, addressId: string, updateData: any) {
    // Map frontend format to backend format if needed
    const backendData: any = {};
    
    if (updateData.fullName) {
      const nameParts = updateData.fullName.trim().split(' ');
      backendData.firstName = nameParts[0] || '';
      backendData.lastName = nameParts.slice(1).join(' ') || backendData.firstName;
    } else {
      if (updateData.firstName) backendData.firstName = updateData.firstName;
      if (updateData.lastName) backendData.lastName = updateData.lastName;
    }

    if (updateData.address) backendData.addressLine1 = updateData.address;
    if (updateData.addressLine1) backendData.addressLine1 = updateData.addressLine1;
    if (updateData.addressLine2) backendData.addressLine2 = updateData.addressLine2;
    if (updateData.city) backendData.city = updateData.city;
    if (updateData.state !== undefined) backendData.state = updateData.state;
    if (updateData.postalCode) backendData.zipCode = updateData.postalCode;
    if (updateData.zipCode) backendData.zipCode = updateData.zipCode;
    if (updateData.country) backendData.country = updateData.country;
    if (updateData.phone) backendData.phone = updateData.phone;
    if (updateData.isDefault !== undefined) backendData.isDefault = updateData.isDefault;
    if (updateData.type) backendData.type = updateData.type;

    const address = await this.addressModel.findOneAndUpdate(
      { _id: addressId, user: userId },
      backendData,
      { new: true, runValidators: true }
    );
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    return {
      success: true,
      address: {
        _id: address._id,
        fullName: `${address.firstName} ${address.lastName}`,
        address: address.addressLine1,
        addressLine2: address.addressLine2,
        city: address.city,
        state: address.state,
        postalCode: address.zipCode,
        country: address.country,
        phone: address.phone,
        isDefault: address.isDefault,
      },
    };
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.addressModel.findOneAndDelete({
      _id: addressId,
      user: userId,
    });
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    return {
      success: true,
      message: 'Address deleted successfully',
    };
  }

  async getPaymentMethods(userId: string) {
    const paymentMethods = await this.paymentMethodModel.find({ user: userId });
    
    // SECURITY: Remove any sensitive data before returning
    // Only return safe fields (never card numbers)
    const safePaymentMethods = paymentMethods.map((pm: any) => ({
      _id: pm._id,
      type: pm.type,
      last4: pm.last4,
      brand: pm.brand,
      cardHolderName: pm.cardHolderName,
      expiryMonth: pm.expiryMonth,
      expiryYear: pm.expiryYear,
      paypalEmail: pm.paypalEmail,
      isDefault: pm.isDefault,
      createdAt: pm.createdAt,
      updatedAt: pm.updatedAt,
      // DO NOT return: cardNumber, stripePaymentMethodId (internal use only)
    }));
    
    return {
      success: true,
      paymentMethods: safePaymentMethods,
    };
  }

  async addPaymentMethod(userId: string, paymentData: Partial<IPaymentMethod>) {
    // SECURITY: Validate that we're not receiving raw card data
    // Check if paymentData has cardNumber property (should not exist in IPaymentMethod)
    if ('cardNumber' in paymentData && paymentData.cardNumber) {
      throw new BadRequestException(
        'Card numbers cannot be stored directly. Use Stripe payment method token instead.'
      );
    }

    // If stripePaymentMethodId is provided, fetch card details from Stripe
    // This ensures we have accurate last4, brand, expiry from Stripe
    if (paymentData.type === 'card' && paymentData.stripePaymentMethodId) {
      try {
        const Stripe = require('stripe');
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (stripeSecretKey) {
          const stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2024-11-20.acacia',
          });
          const stripePaymentMethod = await stripe.paymentMethods.retrieve(
            paymentData.stripePaymentMethodId
          );
          if (stripePaymentMethod.card) {
            paymentData.last4 = stripePaymentMethod.card.last4;
            paymentData.brand = stripePaymentMethod.card.brand;
            paymentData.expiryMonth = String(stripePaymentMethod.card.exp_month).padStart(2, '0');
            paymentData.expiryYear = String(stripePaymentMethod.card.exp_year);
          }
        }
      } catch (error) {
        // Log error but continue - card details may be provided manually
        console.error('Error fetching Stripe payment method details:', error);
      }
    } else if (paymentData.type === 'card' && !paymentData.stripePaymentMethodId) {
      throw new BadRequestException(
        'Stripe payment method ID is required for card payments. Use Stripe Elements to create a payment method.'
      );
    }

    // Set other payment methods to not default if this one is default
    if (paymentData.isDefault) {
      await this.paymentMethodModel.updateMany(
        { user: userId },
        { isDefault: false }
      );
    }

    const paymentMethod = await this.paymentMethodModel.create({
      ...paymentData,
      user: userId,
    });

    // Return safe data only (no sensitive information)
    const safePaymentMethod = {
      _id: paymentMethod._id,
      type: paymentMethod.type,
      last4: paymentMethod.last4,
      brand: paymentMethod.brand,
      cardHolderName: paymentMethod.cardHolderName,
      expiryMonth: paymentMethod.expiryMonth,
      expiryYear: paymentMethod.expiryYear,
      paypalEmail: paymentMethod.paypalEmail,
      isDefault: paymentMethod.isDefault,
      createdAt: paymentMethod.createdAt,
      updatedAt: paymentMethod.updatedAt,
    };

    return {
      success: true,
      paymentMethod: safePaymentMethod,
    };
  }

  async updatePaymentMethod(
    userId: string,
    paymentMethodId: string,
    updateData: { cardHolderName?: string; isDefault?: boolean }
  ) {
    const paymentMethod = await this.paymentMethodModel.findOne({
      _id: paymentMethodId,
      user: userId,
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    // If setting as default, unset other defaults
    if (updateData.isDefault) {
      await this.paymentMethodModel.updateMany(
        { user: userId, _id: { $ne: paymentMethodId } },
        { isDefault: false }
      );
    }

    const updated = await this.paymentMethodModel.findByIdAndUpdate(
      paymentMethodId,
      updateData,
      { new: true }
    );

    // Return safe data only
    const safePaymentMethod = {
      _id: updated._id,
      type: updated.type,
      last4: updated.last4,
      brand: updated.brand,
      cardHolderName: updated.cardHolderName,
      expiryMonth: updated.expiryMonth,
      expiryYear: updated.expiryYear,
      paypalEmail: updated.paypalEmail,
      isDefault: updated.isDefault,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    return {
      success: true,
      paymentMethod: safePaymentMethod,
    };
  }

  async deletePaymentMethod(userId: string, paymentMethodId: string) {
    const paymentMethod = await this.paymentMethodModel.findOne({
      _id: paymentMethodId,
      user: userId,
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    // If stripePaymentMethodId exists, delete from Stripe
    if (paymentMethod.stripePaymentMethodId) {
      try {
        const Stripe = require('stripe');
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        if (stripeSecretKey) {
          const stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2024-11-20.acacia',
          });
          await stripe.paymentMethods.detach(paymentMethod.stripePaymentMethodId);
        }
      } catch (error) {
        // Log error but continue with database deletion
        console.error('Error deleting payment method from Stripe:', error);
      }
    }

    await this.paymentMethodModel.findOneAndDelete({
      _id: paymentMethodId,
      user: userId,
    });

    return {
      success: true,
      message: 'Payment method deleted successfully',
    };
  }

  async getWishlist(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    
    // Get wishlist products (assuming wishlist is stored as array of product IDs in user)
    const wishlistIds = (user as any).wishlist || [];
    const products = await this.productModel
      .find({ _id: { $in: wishlistIds }, status: 'approved' })
      .populate('category', 'name slug')
      .populate('seller', 'name email')
      .lean();

    return {
      success: true,
      wishlist: products,
    };
  }

  async addToWishlist(userId: string, productId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const product = await this.productModel.findById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const wishlist = (user as any).wishlist || [];
    if (wishlist.includes(productId)) {
      throw new BadRequestException('Product already in wishlist');
    }

    wishlist.push(productId);
    await this.userModel.findByIdAndUpdate(userId, { wishlist });

    return {
      success: true,
      message: 'Product added to wishlist',
    };
  }

  async removeFromWishlist(userId: string, productId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const wishlist = (user as any).wishlist || [];
    const updatedWishlist = wishlist.filter((id: string) => id.toString() !== productId);
    await this.userModel.findByIdAndUpdate(userId, { wishlist: updatedWishlist });

    return {
      success: true,
      message: 'Product removed from wishlist',
    };
  }

  async clearWishlist(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, { wishlist: [] });
    return {
      success: true,
      message: 'Wishlist cleared',
    };
  }
}

