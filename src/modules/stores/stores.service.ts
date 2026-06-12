import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { Store, IStore } from '../../models/Store.model';
import { User, IUser } from '../../models/User.model';
import { IProduct } from '../../models/Product.model';

@Injectable()
export class StoresService {
  constructor(
    @InjectModel('Store') private storeModel: Model<IStore>,
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Product') private productModel: Model<IProduct>,
  ) {}

  async getStoreBySeller(sellerId: string) {
    const store = await this.storeModel.findOne({ seller: sellerId });
    if (!store) {
      const seller = await this.userModel.findById(sellerId);
      if (!seller || seller.role !== 'seller') {
        throw new NotFoundException('Seller not found');
      }

      const slugSource = seller.name || seller.email?.split('@')[0] || sellerId.toString();
      const slug = slugSource
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      // SS-9: seed address from sellerInfo so seller does not have to re-enter it
      const sellerInfo = (seller as any).sellerInfo;
      const seedAddress = sellerInfo
        ? {
            street: sellerInfo.businessAddress || '',
            city: sellerInfo.city || '',
            state: sellerInfo.state || '',
            zipCode: sellerInfo.zipCode || '',
            country: sellerInfo.country || '',
          }
        : undefined;

      const newStore = await this.storeModel.create({
        seller: sellerId,
        storeName: seller.name || 'My Store',
        slug: `${slug}-${Date.now()}`,
        status: 'active',
        ...(seedAddress ? { address: seedAddress } : {}),
      });
      return { success: true, store: newStore };
    }
    return { success: true, store };
  }

  async getStoreBySlug(slug: string) {
    const store = await this.storeModel.findOne({ slug, status: 'active' }).populate('seller', 'name email');
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return { success: true, store };
  }

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
      this.storeModel.find(query).populate('seller', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit),
      this.storeModel.countDocuments(query),
    ]);
    return { success: true, stores, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async getNearbyStores(filters?: { city?: string; limit?: number }) {
    const query: Record<string, unknown> = { status: 'active' };
    if (filters?.city) {
      const safe = String(filters.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      query['address.city'] = { $regex: safe, $options: 'i' };
    }
    const limit = Math.min(Math.max(1, Number(filters?.limit) || 50), 100);
    const stores = await this.storeModel.find(query).populate('seller', 'name email').sort({ createdAt: -1 }).limit(limit);
    return { success: true, stores };
  }

  async getStoreById(id: string) {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Store not found');
    }
    const store = await this.storeModel.findOne({ _id: id, status: 'active' }).populate('seller', 'name email');
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return { success: true, store };
  }

  async updateStore(sellerId: string, updateData: any) {
    let store = await this.storeModel.findOne({ seller: sellerId });

    // SECURITY: Whitelist only safe store fields. Block Mass Assignment.
    // Sellers must not be able to reactivate suspended stores or reassign store ownership.
    // SS-4: 'settings' added so profile and settings can be saved in one atomic PUT.
    const allowedFields = ['storeName', 'description', 'logo', 'banner', 'slug', 'address', 'contact', 'socialMedia', 'settings'];
    const filteredUpdateData: any = {};
    for (const key of Object.keys(updateData)) {
      if (allowedFields.includes(key)) {
        filteredUpdateData[key] = updateData[key];
      }
    }

    // SS-4: deep-merge settings when included so partial updates do not wipe existing policy fields
    if (filteredUpdateData.settings && store?.settings) {
      const existing: any =
        typeof (store.settings as any).toObject === 'function'
          ? (store.settings as any).toObject()
          : Object.assign({}, store.settings);
      filteredUpdateData.settings = { ...existing, ...filteredUpdateData.settings };
    }

    if (!store) {
      const seller = await this.userModel.findById(sellerId);
      if (!seller || seller.role !== 'seller') {
        throw new NotFoundException('Seller not found');
      }

      if (!filteredUpdateData.slug && filteredUpdateData.storeName) {
        filteredUpdateData.slug = filteredUpdateData.storeName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
      }

      if (filteredUpdateData.slug) {
        const existingStore = await this.storeModel.findOne({ slug: filteredUpdateData.slug });
        if (existingStore) {
          throw new BadRequestException('Store with this slug already exists');
        }
      }

      store = await this.storeModel.create({
        ...filteredUpdateData,
        seller: sellerId,
        status: 'active',
      });
    } else {
      if (filteredUpdateData.slug && filteredUpdateData.slug !== store.slug) {
        const existingStore = await this.storeModel.findOne({ slug: filteredUpdateData.slug, _id: { $ne: store._id } });
        if (existingStore) {
          throw new BadRequestException('Store with this slug already exists');
        }
      }

      store = await this.storeModel.findByIdAndUpdate(store._id, filteredUpdateData, { new: true, runValidators: true });
    }

    return { success: true, store };
  }

  async adminGetStoreById(id: string) {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Store not found');
    }
    // Bypasses the active filter - admin view shows all statuses
    const store = await this.storeModel.findById(id).populate('seller', 'name email');
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return { success: true, store };
  }

  async adminListStores(params: { page?: number; limit?: number; search?: string; status?: string }) {
    const query: Record<string, unknown> = {};
    if (params.status && ['active', 'inactive'].includes(params.status)) {
      query.status = params.status;
    }
    if (params.search?.trim()) {
      const safe = params.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
      query.$or = [{ storeName: { $regex: safe, $options: 'i' } }, { slug: { $regex: safe, $options: 'i' } }];
    }
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(Math.max(1, Number(params.limit) || 20), 100);
    const skip = (page - 1) * limit;
    const [stores, total] = await Promise.all([
      this.storeModel.find(query).populate('seller', 'name email').sort({ createdAt: -1 }).skip(skip).limit(limit),
      this.storeModel.countDocuments(query),
    ]);
    // SS-13: attach productCount per store in a single batch query
    const sellerIds = stores.map((s) => s.seller);
    const productCounts = await this.productModel.aggregate([
      { $match: { seller: { $in: sellerIds } } },
      { $group: { _id: '$seller', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(productCounts.map((r: any) => [String(r._id), r.count as number]));
    const storesWithCounts = stores.map((s) => {
      const plain = typeof (s as any).toObject === 'function' ? (s as any).toObject() : { ...s };
      plain.productCount = countMap.get(String(s.seller)) ?? 0;
      return plain;
    });
    return { success: true, stores: storesWithCounts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async adminUpdateStoreStatus(id: string, status: 'active' | 'inactive') {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Store not found');
    }
    const store = await this.storeModel.findByIdAndUpdate(id, { status }, { new: true }).populate('seller', 'name email');
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return { success: true, store };
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

    return { success: true, store };
  }
}
