import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ICollection } from '../../models/Collection.model';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';

@Injectable()
export class CollectionsService {
  constructor(
    @InjectModel('Collection') private collectionModel: Model<ICollection>,
  ) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
    const base = this.slugify(name);
    let slug = base;
    let counter = 1;

    while (true) {
      const filter: any = { slug };
      if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) };

      const existing = await this.collectionModel.findOne(filter).lean();
      if (!existing) break;

      slug = `${base}-${counter}`;
      counter++;
    }

    return slug;
  }

  async findAll(query: any) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const filter: any = { isActive: true };

    if (query.featured === 'true' || query.featured === true) {
      filter.isFeatured = true;
    }

    const [collections, total] = await Promise.all([
      this.collectionModel
        .find(filter)
        .select('-products')
        .sort({ displayOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.collectionModel.countDocuments(filter),
    ]);

    return {
      success: true,
      collections,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async findFeatured() {
    const collections = await this.collectionModel
      .find({ isFeatured: true, isActive: true })
      .select('-products')
      .sort({ displayOrder: 1, createdAt: -1 })
      .limit(6)
      .lean();

    return { success: true, collections };
  }

  async findOneByIdOrSlug(idOrSlug: string, query: any) {
    const productPage = Math.max(1, parseInt(query.page, 10) || 1);
    const productLimit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 12));
    const productSkip = (productPage - 1) * productLimit;

    // Try as ObjectId first, then fall back to slug
    let collection: any = null;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(idOrSlug);

    if (isObjectId) {
      collection = await this.collectionModel.findById(idOrSlug).lean();
    }

    if (!collection) {
      collection = await this.collectionModel.findOne({ slug: idOrSlug }).lean();
    }

    if (!collection) throw new NotFoundException('Collection not found');

    // Paginate the products array
    const allProductIds: Types.ObjectId[] = collection.products || [];
    const pagedProductIds = allProductIds.slice(productSkip, productSkip + productLimit);

    // Populate only the paged slice
    const populated = await this.collectionModel
      .findById(collection._id)
      .populate({
        path: 'products',
        select: 'name price images rating status',
        match: { _id: { $in: pagedProductIds } },
      })
      .lean();

    const result = {
      ...collection,
      products: (populated as any)?.products || [],
      productsPagination: {
        page: productPage,
        limit: productLimit,
        total: allProductIds.length,
        pages: Math.ceil(allProductIds.length / productLimit),
      },
    };

    return { success: true, collection: result };
  }

  async create(dto: CreateCollectionDto) {
    const slug = await this.generateUniqueSlug(dto.name);

    const collection = await this.collectionModel.create({
      name: dto.name,
      slug,
      description: dto.description,
      image: dto.image,
      products: (dto.products || []).map((id) => new Types.ObjectId(id)),
      isFeatured: dto.isFeatured ?? false,
      displayOrder: dto.displayOrder ?? 0,
      isActive: true,
    });

    return { success: true, collection };
  }

  async update(id: string, dto: UpdateCollectionDto) {
    const collection = await this.collectionModel.findById(id);
    if (!collection) throw new NotFoundException('Collection not found');

    const updateData: any = { ...dto };

    // Regenerate slug if name changed
    if (dto.name && dto.name !== collection.name) {
      updateData.slug = await this.generateUniqueSlug(dto.name, id);
    }

    if (dto.products) {
      updateData.products = dto.products.map((pid) => new Types.ObjectId(pid));
    }

    const updated = await this.collectionModel
      .findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .lean();

    return { success: true, collection: updated };
  }

  async remove(id: string) {
    const collection = await this.collectionModel.findByIdAndDelete(id);
    if (!collection) throw new NotFoundException('Collection not found');
    return { success: true, message: 'Collection deleted successfully' };
  }
}
