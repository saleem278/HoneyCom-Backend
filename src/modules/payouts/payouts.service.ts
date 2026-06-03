import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { IPayout } from '../../models/Payout.model';
import { IProduct } from '../../models/Product.model';
import { IOrder } from '../../models/Order.model';
import { RequestPayoutDto } from './dto/request-payout.dto';

@Injectable()
export class PayoutsService {
  constructor(
    @InjectModel('Payout') private payoutModel: Model<IPayout>,
    @InjectModel('Product') private productModel: Model<IProduct>,
    @InjectModel('Order') private orderModel: Model<IOrder>,
  ) {}

  private async computeBalance(sellerId: string) {
    const products = await this.productModel.find({ seller: sellerId }).select('_id');
    const productIds = products.map(p => p._id);

    const earningsAgg = await this.orderModel.aggregate([
      { $match: { 'items.product': { $in: productIds }, status: 'delivered' } },
      { $unwind: '$items' },
      { $match: { 'items.product': { $in: productIds } } },
      {
        $group: {
          _id: null,
          totalNetEarnings: {
            $sum: {
              $ifNull: [
                '$items.sellerEarning',
                { $multiply: ['$items.price', '$items.quantity'] },
              ],
            },
          },
        },
      },
    ]);
    const totalEarnings = earningsAgg[0]?.totalNetEarnings ?? 0;

    const payoutAgg = await this.payoutModel.aggregate([
      {
        $match: {
          seller: new mongoose.Types.ObjectId(sellerId),
          status: { $in: ['pending', 'approved', 'paid'] },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const totalPaidOut = payoutAgg[0]?.total ?? 0;

    const availableBalance = Math.max(0, totalEarnings - totalPaidOut);
    return { availableBalance, totalEarnings, totalPaidOut };
  }

  async getBalance(sellerId: string) {
    const balance = await this.computeBalance(sellerId);
    return { success: true, balance };
  }

  async requestPayout(sellerId: string, dto: RequestPayoutDto) {
    const { availableBalance } = await this.computeBalance(sellerId);
    if (dto.amount > availableBalance) {
      throw new BadRequestException(
        `Requested amount (${dto.amount}) exceeds available balance (${availableBalance.toFixed(2)})`,
      );
    }

    const existingPending = await this.payoutModel.findOne({
      seller: sellerId,
      status: 'pending',
    });
    if (existingPending) {
      throw new BadRequestException(
        'You already have a pending payout request. Wait for it to be processed before submitting another.',
      );
    }

    const payout = await this.payoutModel.create({ seller: sellerId, ...dto });
    return { success: true, payout };
  }

  async getPayouts(
    role: string,
    sellerId: string,
    status?: string,
    page = 1,
    limit = 20,
  ) {
    const filter: any = {};
    if (role !== 'admin') filter.seller = sellerId;
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const [payouts, total] = await Promise.all([
      this.payoutModel
        .find(filter)
        .populate('seller', 'name email')
        .populate('processedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.payoutModel.countDocuments(filter),
    ]);

    return {
      success: true,
      payouts,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  async getPayoutById(id: string, sellerId: string, role: string) {
    const payout = await this.payoutModel
      .findById(id)
      .populate('seller', 'name email')
      .populate('processedBy', 'name email')
      .lean();

    if (!payout) throw new NotFoundException('Payout not found');

    const payoutSellerId =
      payout.seller && typeof payout.seller === 'object' && '_id' in payout.seller
        ? (payout.seller as any)._id?.toString()
        : String(payout.seller);

    if (role !== 'admin' && payoutSellerId !== sellerId) {
      throw new ForbiddenException('Not authorized to view this payout');
    }

    return { success: true, payout };
  }

  async approvePayout(id: string, adminId: string, adminNotes?: string) {
    const payout = await this.payoutModel.findById(id);
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'pending') {
      throw new BadRequestException(
        `Cannot approve a payout with status '${payout.status}'`,
      );
    }

    payout.status = 'approved';
    payout.processedBy = adminId as any;
    payout.processedAt = new Date();
    if (adminNotes) payout.adminNotes = adminNotes;
    await payout.save();

    return { success: true, payout };
  }

  async rejectPayout(
    id: string,
    adminId: string,
    rejectionReason: string,
    adminNotes?: string,
  ) {
    const payout = await this.payoutModel.findById(id);
    if (!payout) throw new NotFoundException('Payout not found');
    if (!['pending', 'approved'].includes(payout.status)) {
      throw new BadRequestException(
        `Cannot reject a payout with status '${payout.status}'`,
      );
    }

    payout.status = 'rejected';
    payout.processedBy = adminId as any;
    payout.processedAt = new Date();
    payout.rejectionReason = rejectionReason;
    if (adminNotes) payout.adminNotes = adminNotes;
    await payout.save();

    return { success: true, payout };
  }

  async markPaid(id: string, adminId: string, adminNotes?: string) {
    const payout = await this.payoutModel.findById(id);
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status !== 'approved') {
      throw new BadRequestException(
        `Cannot mark as paid a payout with status '${payout.status}'. Approve it first.`,
      );
    }

    payout.status = 'paid';
    payout.processedBy = adminId as any;
    payout.processedAt = new Date();
    if (adminNotes) payout.adminNotes = adminNotes;
    await payout.save();

    return { success: true, payout };
  }
}
