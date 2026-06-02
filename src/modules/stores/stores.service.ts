import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
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

      // email may be undefined for phone-only accounts; fall back to a stable
      // identifier rather than crashing during default store creation.
      const slugSource = seller.name || seller.email?.split('@')[0] || sellerId.toString();
      const slug = slugSource
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

  // Public browse: list active stores, paginated and limited. Optional city
  // filter (case-insensitive, regex-escaped to avoid ReDoS).
  async getAllStores(filters?: { city?: string; page?: number; limit?: number }) {
    const query: Record<string, unknown> = { status: 'active' };
    if (filters?.city) {
      const safe = String(filters.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      query['address.city'] = { $regex: safe, $options: 'i' };
    }
    const page = Math.max(1, Number(filters?.page) || 1);
    const limit = Math.min(Math.max(1, Number(filters?.limit) || 20), 100);
    const skip = (page - 1) * limit;
    const [stores, total] = await Promise.all([
      this.storeModel
        .find(query)
        .populate('seller', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      this.storeModel.countDocuments(query),
    ]);
    return {
      success: true,
      stores,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  // Best-effort "nearby": the Store model carries no geo coordinates, so a true
  // $near query is not possible. Return active stores (optionally narrowed by
  // city) so the client can still browse; the mobile screen degrades gracefully
  // when a store has no coordinates.
  async getNearbyStores(filters?: { city?: string; limit?: number }) {
    const query: Record<string, unknown> = { status: 'active' };
    if (filters?.city) {
      const safe = String(filters.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      query['address.city'] = { $regex: safe, $options: 'i' };
    }
    const limit = Math.min(Math.max(1, Number(filters?.limit) || 50), 100);
    const stores = await this.storeModel
      .find(query)
      .populate('seller', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit);
    return { success: true, stores };
  }

  async getStoreById(id: string) {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Store not found');
    }
    const store = await this.storeModel
      .findOne({ _id: id, status: 'active' })
      .populate('seller', 'name email');
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return { success: true, store };
  }

  async updateStore(sellerId: string, updateData: any) {
    let store = await this.storeModel.findOne({ seller: sellerId });
    
    // SECURITY: Whitelist only safe store fields. Block Mass Assignment.
    // Sellers must not be able to reactivate suspended stores or reassign store ownership.
    const allowedFields = [
      'storeName', 'description', 'logo', 'banner', 'slug', 
      'address', 'contact', 'socialMedia'
    ];
    const filteredUpdateData: any = {};
    for (const key of Object.keys(updateData)) {
      if (allowedFields.includes(key)) {
        filteredUpdateData[key] = updateData[key];
      }
    }

    if (!store) {
      // Create store if doesn't exist
      const seller = await this.userModel.findById(sellerId);
      if (!seller || seller.role !== 'seller') {
        throw new NotFoundException('Seller not found');
      }

      // Generate slug if not provided
      if (!filteredUpdateData.slug && filteredUpdateData.storeName) {
        filteredUpdateData.slug = filteredUpdateData.storeName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      }

      // Check slug uniqueness
      if (filteredUpdateData.slug) {
        const existingStore = await this.storeModel.findOne({ slug: filteredUpdateData.slug });
        if (existingStore) {
          throw new BadRequestException('Store with this slug already exists');
        }
      }

      store = await this.storeModel.create({
        ...filteredUpdateData,
        seller: sellerId,
        status: 'active', // Default status is active on creation
      });
    } else {
      // Update existing store
      if (filteredUpdateData.slug && filteredUpdateData.slug !== store.slug) {
        const existingStore = await this.storeModel.findOne({ slug: filteredUpdateData.slug, _id: { $ne: store._id } });
        if (existingStore) {
          throw new BadRequestException('Store with this slug already exists');
        }
      }

      store = await this.storeModel.findByIdAndUpdate(
        store._id,
        filteredUpdateData,
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

