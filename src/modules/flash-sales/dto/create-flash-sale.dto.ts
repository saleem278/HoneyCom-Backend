import { IsString, IsNumber, IsDateString, IsOptional, IsBoolean, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFlashSaleDto {
  @ApiProperty({ description: 'Product ID' })
  @IsString()
  product: string;

  @ApiPropertyOptional({ description: 'Display title for the flash sale' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: 'Discounted sale price' })
  @IsNumber()
  @Min(0)
  salePrice: number;

  @ApiProperty({ description: 'Sale start time (ISO 8601)' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ description: 'Sale end time (ISO 8601)' })
  @IsDateString()
  endTime: string;

  @ApiPropertyOptional({ description: 'Max units available at sale price; 0 = unlimited', default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockLimit?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
