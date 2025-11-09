import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, ICategory } from '../../models/Category.model';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel('Category') private categoryModel: Model<ICategory>,
  ) {}

  async findAll() {
    const categories = await this.categoryModel.find().sort({ name: 1 });
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

