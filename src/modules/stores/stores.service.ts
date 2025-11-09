import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Store, IStore } from '../../models/Store.model';
import { User, IUser } from '../../models/User.model';

@Injectable()
export class StoresService {
  constructor(
    @InjectModel('Store') private storeModel: Model<IStore>,
    @InjectModel('User') private userModel: Model<IUser>,
  ) {}

  async getStoreBySeller(sellerId: string) {
    const store = await this.storeModel.findOne({ seller: sellerId });
    if (!store) {
      // Create default store if doesn't exist
      const seller = await this.userModel.findById(sellerId);
      if (!seller || seller.role !== 'seller') {
        throw new NotFoundException('Seller not found');
      }

      const slug = (seller.name || seller.email.split('@')[0])
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const newStore = await this.storeModel.create({
        seller: sellerId,
        storeName: seller.name || 'My Store',
        slug: `${slug}-${Date.now()}`,
        status: 'active',
      });
      return {
        success: true,
        store: newStore,
      };
    }
    return {
      success: true,
      store,
    };
  }

  async getStoreBySlug(slug: string) {
    const store = await this.storeModel.findOne({ slug, status: 'active' })
      .populate('seller', 'name email');
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return {
      success: true,
      store,
    };
  }

  async updateStore(sellerId: string, updateData: any) {
    let store = await this.storeModel.findOne({ seller: sellerId });
    
    if (!store) {
      // Create store if doesn't exist
      const seller = await this.userModel.findById(sellerId);
      if (!seller || seller.role !== 'seller') {
        throw new NotFoundException('Seller not found');
      }

      // Generate slug if not provided
      if (!updateData.slug && updateData.storeName) {
        updateData.slug = updateData.storeName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      }

      // Check slug uniqueness
      if (updateData.slug) {
        const existingStore = await this.storeModel.findOne({ slug: updateData.slug });
        if (existingStore) {
          throw new BadRequestException('Store with this slug already exists');
        }
      }

      store = await this.storeModel.create({
        ...updateData,
        seller: sellerId,
      });
    } else {
      // Update existing store
      if (updateData.slug && updateData.slug !== store.slug) {
        const existingStore = await this.storeModel.findOne({ slug: updateData.slug, _id: { $ne: store._id } });
        if (existingStore) {
          throw new BadRequestException('Store with this slug already exists');
        }
      }

      store = await this.storeModel.findByIdAndUpdate(
        store._id,
        updateData,
        { new: true, runValidators: true }
      );
    }

    return {
      success: true,
      store,
    };
  }

  async updateStoreSettings(sellerId: string, settings: any) {
    const store = await this.storeModel.findOne({ seller: sellerId });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    store.settings = {
      ...store.settings,
      ...settings,
    };
    await store.save();

    return {
      success: true,
      store,
    };
  }
}

