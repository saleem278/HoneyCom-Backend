import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Coupon, ICoupon } from '../../models/Coupon.model';

@Injectable()
export class CouponsService {
  constructor(
    @InjectModel('Coupon') private couponModel: Model<ICoupon>,
  ) {}

  async findAll(filters?: { status?: string; search?: string }) {
    const query: any = {};
    
    if (filters?.status) {
      query.status = filters.status;
    }
    
    if (filters?.search) {
      query.code = { $regex: filters.search, $options: 'i' };
    }

    const coupons = await this.couponModel.find(query).sort({ createdAt: -1 });
    return {
      success: true,
      coupons,
    };
  }

  async findOne(id: string) {
    const coupon = await this.couponModel.findById(id);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    return {
      success: true,
      coupon,
    };
  }

  async findByCode(code: string) {
    const coupon = await this.couponModel.findOne({ code: code.toUpperCase(), status: 'active' });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    
    // Check if coupon is valid
    const now = new Date();
    if (now < coupon.validFrom) {
      throw new BadRequestException('Coupon is not yet valid');
    }
    if (now > coupon.validUntil) {
      throw new BadRequestException('Coupon has expired');
    }
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException('Coupon usage limit reached');
    }

    return {
      success: true,
      coupon,
    };
  }

  async create(couponData: any) {
    // Validate dates
    if (new Date(couponData.validFrom) >= new Date(couponData.validUntil)) {
      throw new BadRequestException('Valid until date must be after valid from date');
    }

    // Validate value based on type
    if (couponData.type === 'percentage' && couponData.value > 100) {
      throw new BadRequestException('Percentage value cannot exceed 100');
    }

    // Check if code already exists
    const existingCoupon = await this.couponModel.findOne({ code: couponData.code.toUpperCase() });
    if (existingCoupon) {
      throw new BadRequestException('Coupon code already exists');
    }

    couponData.code = couponData.code.toUpperCase();
    const coupon = await this.couponModel.create(couponData);
    
    return {
      success: true,
      coupon,
    };
  }

  async update(id: string, couponData: any) {
    const coupon = await this.couponModel.findById(id);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    // Validate dates if provided
    if (couponData.validFrom || couponData.validUntil) {
      const validFrom = couponData.validFrom ? new Date(couponData.validFrom) : coupon.validFrom;
      const validUntil = couponData.validUntil ? new Date(couponData.validUntil) : coupon.validUntil;
      
      if (validFrom >= validUntil) {
        throw new BadRequestException('Valid until date must be after valid from date');
      }
    }

    // Validate value based on type
    if (couponData.type === 'percentage' && couponData.value > 100) {
      throw new BadRequestException('Percentage value cannot exceed 100');
    }

    // Check if code is being changed and if it already exists
    if (couponData.code && couponData.code.toUpperCase() !== coupon.code) {
      const existingCoupon = await this.couponModel.findOne({ 
        code: couponData.code.toUpperCase(),
        _id: { $ne: id }
      });
      if (existingCoupon) {
        throw new BadRequestException('Coupon code already exists');
      }
      couponData.code = couponData.code.toUpperCase();
    }

    const updatedCoupon = await this.couponModel.findByIdAndUpdate(
      id,
      couponData,
      { new: true, runValidators: true }
    );

    return {
      success: true,
      coupon: updatedCoupon,
    };
  }

  async delete(id: string) {
    const coupon = await this.couponModel.findById(id);
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    await this.couponModel.findByIdAndDelete(id);
    
    return {
      success: true,
      message: 'Coupon deleted successfully',
    };
  }

  async incrementUsage(code: string) {
    const coupon = await this.couponModel.findOne({ code: code.toUpperCase() });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    coupon.usedCount += 1;
    await coupon.save();

    return {
      success: true,
      coupon,
    };
  }
}

