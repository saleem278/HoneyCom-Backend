import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsIn,
  IsNumber,
  IsOptional,
  IsDateString,
  IsArray,
  Min,
} from 'class-validator';

/**
 * Create-coupon payload. Because the global ValidationPipe runs with
 * `whitelist + forbidNonWhitelisted`, every field the client may legitimately
 * send must be declared here or the request 400s. Date strings are validated
 * as ISO strings (the service converts them with `new Date(...)`).
 */
export class CreateCouponDto {
  @ApiProperty({ example: 'SAVE20' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ enum: ['percentage', 'fixed'], example: 'percentage' })
  @IsIn(['percentage', 'fixed'])
  type: 'percentage' | 'fixed';

  @ApiProperty({ example: 20, description: 'Discount value (percentage or fixed amount)' })
  @IsNumber()
  @Min(0)
  value: number;

  @ApiPropertyOptional({ example: 500, description: 'Minimum cart subtotal required' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPurchase?: number;

  @ApiPropertyOptional({ example: 1000, description: 'Cap on the discount amount' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscount?: number;

  @ApiPropertyOptional({ example: 100, description: 'Total redemptions across all customers' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  usageLimit?: number;

  @ApiPropertyOptional({ example: 1, description: 'Max redemptions per individual customer' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  perUserLimit?: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  validFrom: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.000Z' })
  @IsDateString()
  validUntil: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive'], example: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @ApiPropertyOptional({ type: [String], description: 'Product IDs this coupon applies to' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableProducts?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Category IDs this coupon applies to' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableCategories?: string[];
}

/**
 * Update payload — every field optional (PATCH-like semantics). The service
 * already revalidates dates and percentage bounds.
 */
export class UpdateCouponDto extends PartialType(CreateCouponDto) {}
