import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IUser } from '../../models/User.model';
import { ILoyaltyTransaction } from '../../models/LoyaltyTransaction.model';
import { ISettings } from '../../models/Settings.model';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';

export interface LoyaltySettings {
  pointsPerRupee: number;
  redemptionRate: number;
  minRedemptionPoints: number;
  maxRedemptionPercent: number;
  welcomeBonus: number;
}

const DEFAULT_SETTINGS: LoyaltySettings = {
  pointsPerRupee: 0.1,       // 1 point per ₹10
  redemptionRate: 0.1,        // 100 points = ₹10
  minRedemptionPoints: 100,
  maxRedemptionPercent: 50,
  welcomeBonus: 100,
};

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('LoyaltyTransaction') private loyaltyTxModel: Model<ILoyaltyTransaction>,
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
  ) {}

  async getSettings(): Promise<LoyaltySettings> {
    const docs = await this.settingsModel.find({ category: 'loyalty' }).lean();
    const map: Record<string, any> = {};
    for (const doc of docs) map[doc.key] = doc.value;
    return {
      pointsPerRupee: map['loyalty.pointsPerRupee'] ?? DEFAULT_SETTINGS.pointsPerRupee,
      redemptionRate: map['loyalty.redemptionRate'] ?? DEFAULT_SETTINGS.redemptionRate,
      minRedemptionPoints: map['loyalty.minRedemptionPoints'] ?? DEFAULT_SETTINGS.minRedemptionPoints,
      maxRedemptionPercent: map['loyalty.maxRedemptionPercent'] ?? DEFAULT_SETTINGS.maxRedemptionPercent,
      welcomeBonus: map['loyalty.welcomeBonus'] ?? DEFAULT_SETTINGS.welcomeBonus,
    };
  }

  async updateSettings(dto: UpdateLoyaltySettingsDto) {
    const updates: Array<{ key: string; value: any; description: string }> = [
      { key: 'loyalty.pointsPerRupee', value: dto.pointsPerRupee, description: 'Points earned per rupee spent' },
      { key: 'loyalty.redemptionRate', value: dto.redemptionRate, description: 'Rupee value per loyalty point' },
      { key: 'loyalty.minRedemptionPoints', value: dto.minRedemptionPoints, description: 'Minimum points to redeem' },
      { key: 'loyalty.maxRedemptionPercent', value: dto.maxRedemptionPercent, description: 'Max % of order payable with points' },
      { key: 'loyalty.welcomeBonus', value: dto.welcomeBonus, description: 'Bonus points on customer registration' },
    ].filter(u => u.value !== undefined && u.value !== null);

    await Promise.all(
      updates.map(u =>
        this.settingsModel.findOneAndUpdate(
          { key: u.key },
          { key: u.key, value: u.value, category: 'loyalty', description: u.description },
          { upsert: true, new: true },
        ),
      ),
    );
    return { success: true, settings: await this.getSettings() };
  }

  async getBalance(userId: string) {
    const user = await this.userModel.findById(userId).select('loyaltyPoints name email').lean();
    if (!user) throw new NotFoundException('User not found');
    const settings = await this.getSettings();
    const balance = (user as any).loyaltyPoints ?? 0;
    const rupeeValue = +(balance * settings.redemptionRate).toFixed(2);
    return {
      success: true,
      loyalty: {
        points: balance,
        rupeeValue,
        tier: this.getTier(balance),
      },
    };
  }

  async getTransactions(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      this.loyaltyTxModel
        .find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.loyaltyTxModel.countDocuments({ user: userId }),
    ]);
    return {
      success: true,
      transactions,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Award points when an order is marked delivered. Idempotent — skips if
   * a transaction for this orderId already exists.
   */
  async awardOrderPoints(userId: string, orderId: string, orderTotal: number): Promise<void> {
    const existing = await this.loyaltyTxModel.findOne({ user: userId, orderId, type: 'earn' });
    if (existing) return; // already awarded

    const settings = await this.getSettings();
    const pointsEarned = Math.floor(orderTotal * settings.pointsPerRupee);
    if (pointsEarned <= 0) return;

    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { loyaltyPoints: pointsEarned } },
      { new: true },
    ).select('loyaltyPoints');

    if (!user) return;

    await this.loyaltyTxModel.create({
      user: userId,
      points: pointsEarned,
      type: 'earn',
      description: `Earned for order delivery (₹${orderTotal.toFixed(2)})`,
      orderId,
      balanceAfter: (user as any).loyaltyPoints,
    });

    this.logger.log(`Awarded ${pointsEarned} loyalty points to user ${userId} for order ${orderId}`);
  }

  /**
   * Validate and compute discount for a points-redeem request without
   * touching the database. Use this at checkout to show the discount.
   */
  async previewRedeem(userId: string, pointsToRedeem: number, orderTotal: number) {
    const settings = await this.getSettings();
    const user = await this.userModel.findById(userId).select('loyaltyPoints').lean();
    if (!user) throw new NotFoundException('User not found');

    const balance = (user as any).loyaltyPoints ?? 0;
    if (pointsToRedeem < settings.minRedemptionPoints)
      throw new BadRequestException(`Minimum redemption is ${settings.minRedemptionPoints} points`);
    if (pointsToRedeem > balance)
      throw new BadRequestException('Insufficient loyalty points');

    const discount = +(pointsToRedeem * settings.redemptionRate).toFixed(2);
    const maxDiscount = +(orderTotal * (settings.maxRedemptionPercent / 100)).toFixed(2);
    const cappedDiscount = Math.min(discount, maxDiscount);
    const cappedPoints = cappedDiscount < discount
      ? Math.ceil(cappedDiscount / settings.redemptionRate)
      : pointsToRedeem;

    return {
      success: true,
      preview: {
        pointsRequested: pointsToRedeem,
        pointsApplied: cappedPoints,
        discount: cappedDiscount,
        balanceAfterRedeem: balance - cappedPoints,
      },
    };
  }

  /** Deduct points as part of checkout (call after order is created). */
  async redeemPoints(userId: string, pointsToRedeem: number, orderId?: string) {
    const settings = await this.getSettings();
    const user = await this.userModel.findById(userId).select('loyaltyPoints').lean();
    if (!user) throw new NotFoundException('User not found');

    const balance = (user as any).loyaltyPoints ?? 0;
    if (pointsToRedeem < settings.minRedemptionPoints)
      throw new BadRequestException(`Minimum redemption is ${settings.minRedemptionPoints} points`);
    if (pointsToRedeem > balance)
      throw new BadRequestException('Insufficient loyalty points');

    const discount = +(pointsToRedeem * settings.redemptionRate).toFixed(2);
    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { loyaltyPoints: -pointsToRedeem } },
      { new: true },
    ).select('loyaltyPoints');

    await this.loyaltyTxModel.create({
      user: userId,
      points: pointsToRedeem,
      type: 'redeem',
      description: `Redeemed for ₹${discount} discount`,
      orderId,
      balanceAfter: (updated as any)?.loyaltyPoints ?? 0,
    });

    return { success: true, discount, balanceAfter: (updated as any)?.loyaltyPoints ?? 0 };
  }

  async adminCredit(userId: string, points: number, description: string) {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { loyaltyPoints: points } },
      { new: true },
    ).select('loyaltyPoints name email');
    if (!user) throw new NotFoundException('User not found');

    await this.loyaltyTxModel.create({
      user: userId,
      points,
      type: 'admin_credit',
      description,
      balanceAfter: (user as any).loyaltyPoints,
    });

    return { success: true, loyaltyPoints: (user as any).loyaltyPoints };
  }

  async adminDebit(userId: string, points: number, description: string) {
    const user = await this.userModel.findById(userId).select('loyaltyPoints').lean();
    if (!user) throw new NotFoundException('User not found');
    if (((user as any).loyaltyPoints ?? 0) < points)
      throw new BadRequestException('User has insufficient loyalty points');

    const updated = await this.userModel.findByIdAndUpdate(
      userId,
      { $inc: { loyaltyPoints: -points } },
      { new: true },
    ).select('loyaltyPoints');

    await this.loyaltyTxModel.create({
      user: userId,
      points,
      type: 'admin_debit',
      description,
      balanceAfter: (updated as any)?.loyaltyPoints ?? 0,
    });

    return { success: true, loyaltyPoints: (updated as any)?.loyaltyPoints ?? 0 };
  }

  async adminGetUsers(page = 1, limit = 20, search?: string) {
    const query: any = { role: 'customer' };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.userModel
        .find(query)
        .select('name email loyaltyPoints status createdAt')
        .sort({ loyaltyPoints: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.userModel.countDocuments(query),
    ]);
    return {
      success: true,
      users,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private getTier(points: number): string {
    if (points >= 10000) return 'Platinum';
    if (points >= 5000) return 'Gold';
    if (points >= 1000) return 'Silver';
    return 'Bronze';
  }
}
