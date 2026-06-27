import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Brand, IBrand } from '../../models/Brand.model';
import { IProduct } from '../../models/Product.model';

@Injectable()
export class BrandsService {
  constructor(
    @InjectModel('Brand') private brandModel: Model<IBrand>,
    @InjectModel('Product') private productModel: Model<IProduct>,
  ) {}

  async findAll(status?: string, isAdmin?: boolean) {
    // Admin can see all brands (with optional status filter); public path is active-only.
    const query: Record<string, unknown> = isAdmin
      ? status ? { status } : {}
      : { status: 'active' };
    const brands = await this.brandModel.find(query).sort({ name: 1 }).limit(500).lean();
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
    // Clear the now-dangling brand reference off every product that pointed at
    // this brand. The admin delete-confirm explicitly promises "products will
    // retain their listing but lose the brand association" — without this the
    // products keep an ObjectId pointing at a deleted brand, which breaks
    // brand-faceted browsing (the ?brand=<slug> lookup finds nothing and those
    // products become unreachable) and leaves orphaned refs on detail pages.
    await this.productModel.updateMany({ brand: id }, { $unset: { brand: '' } });
    return {
      success: true,
      message: 'Brand deleted successfully',
    };
  }
}

