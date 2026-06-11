import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, ICategory } from '../../models/Category.model';
import { IProduct } from '../../models/Product.model';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel('Category') private categoryModel: Model<ICategory>,
    @InjectModel('Product') private productModel: Model<IProduct>,
  ) {}

  async findAll(filters?: { featured?: string; status?: string; withCounts?: string }) {
    const query: Record<string, unknown> = {};
    if (filters?.featured === 'true') query.featured = true;
    if (filters?.status) query.status = filters.status;
    const categories = await this.categoryModel
      .find(query)
      // displayOrder first (storefront-controlled order), then name as tiebreak
      .sort({ displayOrder: 1, name: 1 })
      .limit(500)
      .lean();

    // Optionally attach product counts per category (used by admin catalogue page)
    if (filters?.withCounts === 'true' && categories.length > 0) {
      const categoryIds = categories.map((c: any) => c._id);
      const counts = await this.productModel.aggregate([
        { $match: { category: { $in: categoryIds } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
      ]);
      const countMap = new Map(counts.map((c: { _id: any; count: number }) => [String(c._id), c.count]));
      return {
        success: true,
        categories: categories.map((cat: any) => ({
          ...cat,
          productCount: countMap.get(String(cat._id)) ?? 0,
        })),
      };
    }

    return {
      success: true,
      categories,
    };
  }

  async findOne(id: string) {
    const category = await this.categoryModel.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return {
      success: true,
      category,
    };
  }

  async findBySlug(slug: string) {
    const category = await this.categoryModel.findOne({ slug });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return {
      success: true,
      category,
    };
  }

  async create(createCategoryDto: any) {
    const category = await this.categoryModel.create(createCategoryDto);
    return {
      success: true,
      category,
    };
  }

  async update(id: string, updateCategoryDto: any) {
    const category = await this.categoryModel.findByIdAndUpdate(
      id,
      updateCategoryDto,
      { new: true, runValidators: true }
    );
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return {
      success: true,
      category,
    };
  }

  async remove(id: string) {
    const category = await this.categoryModel.findById(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    // Guard: reject delete if products still reference this category
    const productCount = await this.productModel.countDocuments({ category: id });
    if (productCount > 0) {
      throw new BadRequestException(
        `Cannot delete category: ${productCount} product${productCount === 1 ? '' : 's'} still reference it. Move or delete those products first.`
      );
    }
    await this.categoryModel.findByIdAndDelete(id);
    return {
      success: true,
      message: 'Category deleted',
    };
  }
}

