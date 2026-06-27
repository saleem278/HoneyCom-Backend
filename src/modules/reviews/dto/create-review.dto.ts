import {
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateReviewDto {
  @IsMongoId()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  comment: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}

/**
 * Variant used by the `POST /reviews/product/:productId` route where the
 * product id comes from the URL param instead of the body.
 */
export class CreateProductReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  comment: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
