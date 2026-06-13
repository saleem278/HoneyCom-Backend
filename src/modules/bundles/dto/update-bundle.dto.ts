import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  ArrayMinSize,
  IsNumber,
  Min,
  MaxLength,
  IsBoolean,
  IsMongoId,
} from 'class-validator';

export class UpdateBundleDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String], description: 'Array of product IDs (minimum 2)' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsMongoId({ each: true })
  products?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  bundlePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
