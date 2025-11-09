import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Banner, IBanner } from '../../models/Banner.model';

@Injectable()
export class BannersService {
  constructor(
    @InjectModel('Banner') private bannerModel: Model<IBanner>,
  ) {}

  async findAll(position?: string, status?: string) {
    const query: any = {};
    if (position) query.position = position;
    if (status) query.status = status;
    
    const banners = await this.bannerModel
      .find(query)
      .sort({ order: 1, createdAt: -1 });
    return {
      success: true,
      banners,
    };
  }

  async findOne(id: string) {
    const banner = await this.bannerModel.findById(id);
    if (!banner) {
      throw new NotFoundException('Banner not found');
    }
    return {
      success: true,
      banner,
    };
  }

  async create(bannerData: any) {
    // Set default order if not provided
    if (bannerData.order === undefined) {
      const maxOrder = await this.bannerModel
        .findOne({ position: bannerData.position || 'top' })
        .sort({ order: -1 });
      bannerData.order = maxOrder ? maxOrder.order + 1 : 0;
    }

    const banner = await this.bannerModel.create(bannerData);
    return {
      success: true,
      banner,
    };
  }

  async update(id: string, updateData: any) {
    const banner = await this.bannerModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );
    if (!banner) {
      throw new NotFoundException('Banner not found');
    }
    return {
      success: true,
      banner,
    };
  }

  async delete(id: string) {
    const banner = await this.bannerModel.findByIdAndDelete(id);
    if (!banner) {
      throw new NotFoundException('Banner not found');
    }
    return {
      success: true,
      message: 'Banner deleted successfully',
    };
  }

  async getActiveBanners(position?: string) {
    const now = new Date();
    const query: any = {
      status: 'active',
      $and: [
        {
          $or: [
            { startDate: { $exists: false } },
            { startDate: { $lte: now } },
          ],
        },
        {
          $or: [
            { endDate: { $exists: false } },
            { endDate: { $gte: now } },
          ],
        },
      ],
    };
    if (position) query.position = position;

    const banners = await this.bannerModel
      .find(query)
      .sort({ order: 1 })
      .lean();

    return {
      success: true,
      banners,
    };
  }
}

