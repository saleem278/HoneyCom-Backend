import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateLoyaltySettingsDto {
  /** Points earned per unit of currency spent (e.g., 1 point per ₹10 = 0.1) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  pointsPerRupee?: number;

  /** Currency value per point redeemed (e.g., 100 points = ₹10 means 0.1) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  redemptionRate?: number;

  /** Minimum points required to redeem in a single transaction */
  @IsOptional()
  @IsInt()
  @Min(1)
  minRedemptionPoints?: number;

  /** Maximum percentage of order value that can be paid with points (0–100) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxRedemptionPercent?: number;

  /** Bonus points awarded when a new customer registers */
  @IsOptional()
  @IsInt()
  @Min(0)
  welcomeBonus?: number;
}
