import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  ArrayMinSize,
  IsNumber,
  Min,
  MaxLength,
  IsMongoId,
} from 'class-validator';

export class CreateBundleDto {
  @ApiProperty({ example: 'Summer Essentials Bundle', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Everything you need for summer' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [String], description: 'Array of product IDs (minimum 2)', example: ['productId1', 'productId2'] })
  @IsArray()
  @ArrayMinSize(2)
  @IsMongoId({ each: true })
  products: string[];

  @ApiProperty({ example: 499, description: 'Discounted bundle price' })
  @IsNumber()
  @Min(0)
  bundlePrice: number;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/example/image.jpg' })
  @IsOptional()
  @IsString()
  image?: string;
}
