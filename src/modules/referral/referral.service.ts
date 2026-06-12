import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { IUser } from '../../models/User.model';
import { ICart } from '../../models/Cart.model';
import { ISettings } from '../../models/Settings.model';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  // Characters excluding O, 0, I, 1 to avoid visual confusion
  private readonly CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  private readonly CODE_LENGTH = 8;

  constructor(
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Cart') private cartModel: Model<ICart>,
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
  ) {}

  private generateCode(): string {
    let code = '';
    const bytes = crypto.randomBytes(this.CODE_LENGTH);
    for (let i = 0; i < this.CODE_LENGTH; i++) {
      code += this.CODE_CHARS[bytes[i] % this.CODE_CHARS.length];
    }
    return code;
  }

  private async getSetting(key: string, fallback: string): Promise<string> {
    const row = await this.settingsModel.findOne({ key }).lean() as any;
    return row?.value ?? fallback;
  }

  async getMyCode(userId: string): Promise<{ code: string }> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if (!user.referralCode) {
      // Generate unique code
      let code: string;
      let attempts = 0;
      do {
        code = this.generateCode();
        attempts++;
        if (attempts > 20) throw new BadRequestException('Could not generate unique referral code');
      } while (await this.userModel.exists({ referralCode: code }));

      user.referralCode = code;
      await user.save();
    }

    return { code: user.referralCode };
  }

  async validate(code: string, requestingUserId: string): Promise<{ valid: boolean; discount: number }> {
    const enabled = await this.getSetting('referral.enabled', 'true');
    if (enabled !== 'true') {
      return { valid: false, discount: 0 };
    }

    const upper = code.toUpperCase();
    const referrer = await this.userModel.findOne({ referralCode: upper });
    if (!referrer) return { valid: false, discount: 0 };

    // Prevent self-referral
    if (referrer._id.toString() === requestingUserId) {
      return { valid: false, discount: 0 };
    }

    // Check if the requesting user already used a referral code
    const requester = await this.userModel.findById(requestingUserId);
    if (requester?.referralCodeUsed) {
      return { valid: false, discount: 0 };
    }

    const pct = await this.getSetting('referral.refereeDiscountPct', '10');
    return { valid: true, discount: parseInt(pct, 10) || 10 };
  }

  async applyToCart(code: string, userId: string, currency: string): Promise<{ discount: number; message: string }> {
    const { valid, discount: discountPct } = await this.validate(code, userId);
    if (!valid) throw new BadRequestException('Invalid or ineligible referral code');

    const cart = await this.cartModel.findOne({ user: userId }).populate('items.product');
    if (!cart || cart.items.length === 0) throw new BadRequestException('Cart is empty');

    // Calculate discount amount from cart subtotal
    const subtotal = (cart.items as any[]).reduce((sum: number, item: any) => {
      const price = item.product?.price ?? 0;
      return sum + price * item.quantity;
    }, 0);
    const discountAmount = Math.round((subtotal * discountPct) / 100);

    cart.referralCode = code.toUpperCase();
    cart.referralDiscount = discountAmount;
    await cart.save();

    return { discount: discountAmount, message: `Referral code applied: ${discountPct}% off (₹${discountAmount})` };
  }

  async removeFromCart(userId: string): Promise<void> {
    await this.cartModel.updateOne(
      { user: userId },
      { $unset: { referralCode: '', referralDiscount: '' } },
    );
  }

  // Admin methods
  async adminGetSettings(): Promise<Record<string, string>> {
    const keys = ['referral.enabled', 'referral.refereeDiscountPct', 'referral.referrerBonusPts'];
    const rows = await this.settingsModel.find({ key: { $in: keys } }).lean() as any[];
    const map: Record<string, string> = {
      'referral.enabled': 'true',
      'referral.refereeDiscountPct': '10',
      'referral.referrerBonusPts': '100',
    };
    for (const row of rows) {
      map[row.key] = row.value;
    }
    return map;
  }

  async adminUpdateSettings(updates: Record<string, string>): Promise<void> {
    const allowed = ['referral.enabled', 'referral.refereeDiscountPct', 'referral.referrerBonusPts'];
    for (const [key, value] of Object.entries(updates)) {
      if (!allowed.includes(key)) continue;
      await this.settingsModel.findOneAndUpdate(
        { key },
        { key, value: String(value) },
        { upsert: true, new: true },
      );
    }
  }

  async adminGetAggregateSummary() {
    const [totalReferrers, totalSuccessful, bonusAgg] = await Promise.all([
      this.userModel.countDocuments({ referralCode: { $exists: true, $ne: null } }),
      this.userModel.aggregate([
        { $match: { 'referralStats.usedCount': { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$referralStats.usedCount' } } },
      ]).then((r: any[]) => r[0]?.total ?? 0),
      this.userModel.aggregate([
        { $match: { 'referralStats.bonusEarned': { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$referralStats.bonusEarned' } } },
      ]).then((r: any[]) => r[0]?.total ?? 0),
    ]);
    return {
      success: true,
      stats: { totalReferrers, totalSuccessful, totalBonusPts: bonusAgg },
    };
  }

  async adminGetStats(page: number = 1, limit: number = 20, search?: string) {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safePage = Math.max(1, page);
    const skip = (safePage - 1) * safeLimit;

    const filter: any = {
      referralCode: { $exists: true, $ne: null },
    };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { referralCode: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter)
        .select('name email referralCode referralStats loyaltyPoints createdAt')
        .sort({ 'referralStats.usedCount': -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      this.userModel.countDocuments(filter),
    ]);

    return {
      users,
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit),
    };
  }
}
