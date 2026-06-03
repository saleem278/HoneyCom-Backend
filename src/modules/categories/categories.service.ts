import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, ICategory } from '../../models/Category.model';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel('Category') private categoryModel: Model<ICategory>,
  ) {}

  async findAll(filters?: { featured?: string; status?: string }) {
    const query: Record<string, unknown> = {};
    if (filters?.featured === 'true') query.featured = true;
    if (filters?.status) query.status = filters.status;
    const categories = await this.categoryModel
      .find(query)
      // displayOrder first (storefront-controlled order), then name as tiebreak
      .sort({ displayOrder: 1, name: 1 })
      .limit(500)
      .lean();
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
    const category = await this.categoryModel.findByIdAndDelete(id);
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return {
      success: true,
      message: 'Category deleted',
    };
  }
}

