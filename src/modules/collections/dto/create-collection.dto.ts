import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsNumber,
  MaxLength,
  IsMongoId,
  Min,
} from 'class-validator';

export class CreateCollectionDto {
  @ApiProperty({ example: 'Summer Picks', maxLength: 150 })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'Best products for summer' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/example/image.jpg' })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional({ type: [String], description: 'Array of product IDs' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  products?: string[];

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  displayOrder?: number;
}
