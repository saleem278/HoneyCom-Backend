import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IBundle } from '../../models/Bundle.model';
import { IProduct } from '../../models/Product.model';
import { ICart } from '../../models/Cart.model';
import { CreateBundleDto } from './dto/create-bundle.dto';
import { UpdateBundleDto } from './dto/update-bundle.dto';

@Injectable()
export class BundlesService {
  constructor(
    @InjectModel('Bundle') private bundleModel: Model<IBundle>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Cart') private cartModel: Model<ICart>,
  ) {}

  private async computeBundlePrices(
    productIds: string[],
    bundlePrice: number,
  ): Promise<{ originalPrice: number; discountPercent: number }> {
    const products = await this.productModel
      .find({ _id: { $in: productIds }, status: 'approved' })
      .select('price')
      .lean();

    if (products.length < 2) {
      throw new BadRequestException(
        'At least 2 approved products are required for a bundle',
      );
    }

    const originalPrice = products.reduce((sum: number, p: any) => sum + p.price, 0);
    const discountPercent =
      originalPrice > 0
        ? Number(((1 - bundlePrice / originalPrice) * 100).toFixed(2))
        : 0;

    return { originalPrice, discountPercent };
  }

  async findAll(query: any, userRole?: string) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 12));
    const skip = (page - 1) * limit;

    const filter: any = {};

    // Public sees only active bundles; admin sees all unless filtered
    if (userRole !== 'admin') {
      filter.isActive = true;
    } else if (query.isActive !== undefined) {
      filter.isActive = query.isActive === 'true' || query.isActive === true;
    }

    if (query.seller && String(query.seller).match(/^[0-9a-fA-F]{24}$/)) {
      filter.seller = query.seller;
    }

    const [bundles, total] = await Promise.all([
      this.bundleModel
        .find(filter)
        .populate('products', 'name price images rating')
        .populate('seller', 'name email')
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      this.bundleModel.countDocuments(filter),
    ]);

    return {
      success: true,
      bundles,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const bundle = await this.bundleModel
      .findById(id)
      .populate('products', 'name price images rating status')
      .populate('seller', 'name email')
      .lean();

    if (!bundle) throw new NotFoundException('Bundle not found');

    return { success: true, bundle };
  }

  async findByProduct(productId: string) {
    const bundles = await this.bundleModel
      .find({ products: new Types.ObjectId(productId), isActive: true })
      .populate('products', 'name price images rating')
      .populate('seller', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    return { success: true, bundles };
  }

  async create(dto: CreateBundleDto, userId: string, userRole: string) {
    const { originalPrice, discountPercent } = await this.computeBundlePrices(
      dto.products,
      dto.bundlePrice,
    );

    if (dto.bundlePrice > originalPrice) {
      throw new BadRequestException(
        'Bundle price must be less than or equal to the sum of individual product prices',
      );
    }

    const bundle = await this.bundleModel.create({
      name: dto.name,
      description: dto.description,
      products: dto.products.map((id) => new Types.ObjectId(id)),
      seller: userRole === 'seller' ? new Types.ObjectId(userId) : undefined,
      bundlePrice: dto.bundlePrice,
      originalPrice,
      discountPercent,
      image: dto.image,
      isActive: true,
    });

    return { success: true, bundle };
  }

  async update(id: string, dto: UpdateBundleDto, userId: string, userRole: string) {
    const bundle = await this.bundleModel.findById(id);
    if (!bundle) throw new NotFoundException('Bundle not found');

    // Ownership check: sellers can only update their own bundles
    if (userRole === 'seller' && (!bundle.seller || bundle.seller.toString() !== userId)) {
      throw new ForbiddenException('Not authorized to update this bundle');
    }

    const updateData: any = { ...dto };

    // Recompute prices if products or bundlePrice changed
    const newProductIds = dto.products ?? bundle.products.map((p) => p.toString());
    const newBundlePrice = dto.bundlePrice ?? bundle.bundlePrice;

    if (dto.products !== undefined || dto.bundlePrice !== undefined) {
      const { originalPrice, discountPercent } = await this.computeBundlePrices(
        newProductIds,
        newBundlePrice,
      );

      if (newBundlePrice > originalPrice) {
        throw new BadRequestException(
          'Bundle price must be less than or equal to the sum of individual product prices',
        );
      }

      updateData.originalPrice = originalPrice;
      updateData.discountPercent = discountPercent;
    }

    if (dto.products) {
      updateData.products = dto.products.map((pid) => new Types.ObjectId(pid));
    }

    const updated = await this.bundleModel
      .findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
      .lean();

    return { success: true, bundle: updated };
  }

  async remove(id: string, userId: string, userRole: string) {
    const bundle = await this.bundleModel.findById(id);
    if (!bundle) throw new NotFoundException('Bundle not found');

    if (userRole === 'seller' && (!bundle.seller || bundle.seller.toString() !== userId)) {
      throw new ForbiddenException('Not authorized to delete this bundle');
    }

    await this.bundleModel.findByIdAndDelete(id);
    return { success: true, message: 'Bundle deleted successfully' };
  }

  async addToCart(bundleId: string, userId: string) {
    const bundle = await this.bundleModel
      .findById(bundleId)
      .populate<{ products: any[] }>('products', '_id status inventory')
      .lean();

    if (!bundle) throw new NotFoundException('Bundle not found');
    if (!bundle.isActive) throw new BadRequestException('Bundle is not active');

    let cart = await this.cartModel.findOne({ user: userId });
    if (!cart) {
      cart = await this.cartModel.create({ user: userId, items: [] });
    }

    // Add each product in the bundle with quantity 1
    for (const product of bundle.products) {
      if (product.status !== 'approved') continue;

      const productId = product._id.toString();
      const existingIdx = cart.items.findIndex(
        (item) => item.product.toString() === productId,
      );

      if (existingIdx > -1) {
        cart.items[existingIdx].quantity += 1;
      } else {
        cart.items.push({ product: product._id, quantity: 1, variants: {} } as any);
      }
    }

    await cart.save();
    return { success: true, message: 'Bundle products added to cart' };
  }
}
