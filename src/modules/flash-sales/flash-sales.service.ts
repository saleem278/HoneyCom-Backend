import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { IFlashSale } from '../../models/FlashSale.model';
import { IProduct } from '../../models/Product.model';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';

@Injectable()
export class FlashSalesService {
  constructor(
    @InjectModel('FlashSale') private flashSaleModel: Model<IFlashSale>,
    @InjectModel('Product') private productModel: Model<IProduct>,
  ) {}

  async create(dto: CreateFlashSaleDto, adminId: string): Promise<IFlashSale> {
    const product = await this.productModel.findById(dto.product).select('price name status');
    if (!product) throw new NotFoundException('Product not found');
    if (product.status !== 'approved') throw new BadRequestException('Only approved products can have flash sales');

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (end <= start) throw new BadRequestException('endTime must be after startTime');
    if (dto.salePrice >= product.price) throw new BadRequestException('salePrice must be less than original price');

    const discountPercent = Math.round(((product.price - dto.salePrice) / product.price) * 100);

    const sale = new this.flashSaleModel({
      product: new mongoose.Types.ObjectId(dto.product),
      title: dto.title,
      originalPrice: product.price,
      salePrice: dto.salePrice,
      discountPercent,
      startTime: start,
      endTime: end,
      stockLimit: dto.stockLimit ?? 0,
      isActive: dto.isActive ?? true,
      createdBy: new mongoose.Types.ObjectId(adminId),
    });
    return sale.save();
  }

  async findAll(options: {
    active?: boolean;
    page?: number;
    limit?: number;
  } = {}): Promise<{ flashSales: IFlashSale[]; pagination: object }> {
    const { page = 1, limit = 20 } = options;
    const query: any = {};
    if (options.active) {
      const now = new Date();
      query.isActive = true;
      query.startTime = { $lte: now };
      query.endTime = { $gt: now };
    }
    // On the public (active) listing, only populate approved products and drop
    // any sale whose product didn't populate — a sale must never advertise an
    // unapproved/removed product. Admin listings (active=false) keep the full
    // population so they can still manage sales for non-approved products.
    const productPopulate = options.active
      ? { path: 'product', select: 'name images price category status', match: { status: 'approved' } }
      : { path: 'product', select: 'name images price category status' };
    let [flashSales, total] = await Promise.all([
      this.flashSaleModel
        .find(query)
        .populate(productPopulate as any)
        .sort({ startTime: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.flashSaleModel.countDocuments(query),
    ]);
    if (options.active) {
      flashSales = (flashSales as any[]).filter((fs) => fs.product);
    }
    return {
      flashSales,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string): Promise<IFlashSale> {
    // Public detail endpoint: only surface a sale that is currently live
    // (active + within its start/end window). Expired, scheduled, or
    // deactivated sales 404 here so customers can't deep-link to a stale price.
    const now = new Date();
    const sale = await this.flashSaleModel
      .findOne({
        _id: id,
        isActive: true,
        startTime: { $lte: now },
        endTime: { $gt: now },
      })
      // Only populate the product if it is approved — an unapproved/removed
      // product populates as null and we reject the sale below.
      .populate({
        path: 'product',
        select: 'name images price category description status',
        match: { status: 'approved' },
      });
    if (!sale) throw new NotFoundException('Flash sale not found');
    // If the product failed the approved-status match it populates as null —
    // don't expose a flash sale for a product that isn't buyable.
    if (!(sale as any).product) throw new NotFoundException('Flash sale not found');
    return sale;
  }

  async update(id: string, dto: UpdateFlashSaleDto): Promise<IFlashSale> {
    const sale = await this.flashSaleModel.findById(id);
    if (!sale) throw new NotFoundException('Flash sale not found');

    if (dto.startTime && dto.endTime) {
      const start = new Date(dto.startTime);
      const end = new Date(dto.endTime);
      if (end <= start) throw new BadRequestException('endTime must be after startTime');
    }

    const patch: any = { ...dto };
    if (dto.salePrice !== undefined) {
      const newSalePrice = dto.salePrice;
      const origPrice = sale.originalPrice;
      if (newSalePrice >= origPrice) throw new BadRequestException('salePrice must be less than original price');
      patch.discountPercent = Math.round(((origPrice - newSalePrice) / origPrice) * 100);
    }

    const updated = await this.flashSaleModel
      .findByIdAndUpdate(id, { $set: patch }, { new: true })
      .populate('product', 'name images price category');
    if (!updated) throw new NotFoundException('Flash sale not found after update');
    return updated;
  }

  async remove(id: string): Promise<void> {
    const sale = await this.flashSaleModel.findByIdAndDelete(id);
    if (!sale) throw new NotFoundException('Flash sale not found');
  }

  async getActive(limit = 10): Promise<IFlashSale[]> {
    const now = new Date();
    const sales = await this.flashSaleModel
      .find({ isActive: true, startTime: { $lte: now }, endTime: { $gt: now } })
      // Only populate approved products; a sale whose product is unapproved or
      // removed populates as null and is filtered out below so it's never shown.
      .populate({
        path: 'product',
        select: 'name images price category rating status',
        match: { status: 'approved' },
      })
      .sort({ discountPercent: -1 })
      .limit(limit)
      .lean();
    return (sales as any[]).filter((fs) => fs.product) as IFlashSale[];
  }

  async incrementSold(id: string, qty = 1): Promise<void> {
    await this.flashSaleModel.findByIdAndUpdate(id, { $inc: { soldCount: qty } });
  }

  async getStats(): Promise<{
    success: boolean;
    stats: { liveCount: number; totalUnitsSold: number; upcomingCount: number };
  }> {
    const now = new Date();
    const [liveCount, upcomingCount, soldAgg] = await Promise.all([
      this.flashSaleModel.countDocuments({
        isActive: true,
        startTime: { $lte: now },
        endTime: { $gt: now },
      }),
      this.flashSaleModel.countDocuments({
        isActive: true,
        startTime: { $gt: now },
      }),
      this.flashSaleModel.aggregate([
        { $group: { _id: null, totalUnitsSold: { $sum: '$soldCount' } } },
      ]),
    ]);
    return {
      success: true,
      stats: {
        liveCount,
        upcomingCount,
        totalUnitsSold: soldAgg[0]?.totalUnitsSold ?? 0,
      },
    };
  }
}
