import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Brand, IBrand } from '../../models/Brand.model';

@Injectable()
export class BrandsService {
  constructor(
    @InjectModel('Brand') private brandModel: Model<IBrand>,
  ) {}

  async findAll() {
    const brands = await this.brandModel.find({ status: 'active' }).sort({ name: 1 });
    return {
      success: true,
      brands,
    };
  }

  async findOne(id: string) {
    const brand = await this.brandModel.findById(id);
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return {
      success: true,
      brand,
    };
  }

  async findBySlug(slug: string) {
    const brand = await this.brandModel.findOne({ slug, status: 'active' });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return {
      success: true,
      brand,
    };
  }

  async create(brandData: any) {
    // Generate slug if not provided
    if (!brandData.slug && brandData.name) {
      brandData.slug = brandData.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    }

    // Check if slug exists
    const existingBrand = await this.brandModel.findOne({ slug: brandData.slug });
    if (existingBrand) {
      throw new BadRequestException('Brand with this slug already exists');
    }

    const brand = await this.brandModel.create(brandData);
    return {
      success: true,
      brand,
    };
  }

  async update(id: string, updateData: any) {
    // If slug is being updated, check uniqueness
    if (updateData.slug) {
      const existingBrand = await this.brandModel.findOne({ slug: updateData.slug, _id: { $ne: id } });
      if (existingBrand) {
        throw new BadRequestException('Brand with this slug already exists');
      }
    }

    const brand = await this.brandModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return {
      success: true,
      brand,
    };
  }

  async delete(id: string) {
    const brand = await this.brandModel.findByIdAndDelete(id);
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return {
      success: true,
      message: 'Brand deleted successfully',
    };
  }
}

