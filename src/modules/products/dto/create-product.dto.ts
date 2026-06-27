import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PriceTierDto } from './price-tier.dto';

/** A product variant axis, e.g. { name: 'Size', options: ['S','M','L'] }. */
export class ProductVariantDto {
  @ApiProperty({ example: 'Size' })
  @IsString()
  name: string;

  @ApiProperty({ type: [String], example: ['S', 'M', 'L'] })
  @IsArray()
  @IsString({ each: true })
  options: string[];
}

/** Physical dimensions used for shipping calculations. */
export class ProductDimensionsDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() length?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() width?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() height?: number;
}

/** A single key/value specification row. */
export class ProductSpecificationDto {
  @ApiProperty({ example: 'Material' })
  @IsString()
  label: string;

  @ApiProperty({ example: 'Cotton' })
  @IsString()
  value: string;
}

/** A single product question/answer entry. */
export class ProductQnADto {
  @ApiProperty()
  @IsString()
  q: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  a?: string;
}

/**
 * Create-product payload. The global ValidationPipe runs with
 * `whitelist + forbidNonWhitelisted + transform`, so every field a client may
 * legitimately send must be declared here or the request 400s.
 *
 * SECURITY: privileged fields (`status`, `featured`, `rating`, `numReviews`,
 * `seller`) are declared so an admin may set them, but the service's `create()`
 * only honours them for admins — a non-admin caller's values are ignored and
 * `status` is forced to `pending`. Declaring them here does NOT grant trust;
 * the service is the authority on which role may set which field.
 */
export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'High-fidelity wireless over-ear headphones.' })
  @IsString()
  description: string;

  @ApiPropertyOptional({ description: 'Stock keeping unit. Auto-generated if omitted.' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ example: 1999 })
  @IsNumber()
  @Min(0.01)
  price: number;

  @ApiPropertyOptional({ example: 2499, description: 'Strike-through / "was" price.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @ApiProperty({ description: 'Category ObjectId or slug.' })
  @IsString()
  category: string;

  @ApiPropertyOptional({ description: 'Brand ObjectId or slug.' })
  @IsOptional()
  @IsString()
  brand?: string;

  @ApiPropertyOptional({ type: [String], description: 'CDN image URLs.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  inventory?: number;

  @ApiPropertyOptional({ type: [ProductVariantDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @ApiPropertyOptional({ example: 0.5, description: 'Weight in kg.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @ApiPropertyOptional({ type: ProductDimensionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductDimensionsDto)
  dimensions?: ProductDimensionsDto;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [ProductSpecificationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSpecificationDto)
  specifications?: ProductSpecificationDto[];

  @ApiPropertyOptional({ type: [ProductQnADto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductQnADto)
  qna?: ProductQnADto[];

  @ApiPropertyOptional({
    type: [PriceTierDto],
    description: 'Wholesale/tiered pricing tiers. Each tier defines a minimum quantity and price.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceTierDto)
  priceTiers?: PriceTierDto[];

  // ── Admin-only fields ────────────────────────────────────────────────────
  // Declared so an admin request validates, but the service ignores these for
  // non-admin callers (see ProductsService.create).

  @ApiPropertyOptional({
    enum: ['pending', 'approved', 'rejected', 'inactive'],
    description: 'Admin-only. Ignored for non-admin callers (forced to "pending").',
  })
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'inactive'])
  status?: 'pending' | 'approved' | 'rejected' | 'inactive';

  @ApiPropertyOptional({ description: 'Admin-only. Ignored for non-admin callers.' })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ description: 'Admin-only. Ignored for non-admin callers.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'Admin-only. Ignored for non-admin callers.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  numReviews?: number;

  @ApiPropertyOptional({
    description: 'Admin-only. Seller ObjectId the product is created on behalf of. Ignored for non-admin callers.',
  })
  @IsOptional()
  @IsString()
  seller?: string;
}
