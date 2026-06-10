import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsArray,
  IsNumber,
  IsOptional,
  MaxLength,
  Min,
  Max,
  Matches,
  ArrayUnique,
} from 'class-validator';

export class UpdateDeliverySlotDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ description: 'HH:MM format' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be in HH:MM format' })
  startTime?: string;

  @ApiPropertyOptional({ description: 'HH:MM format' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must be in HH:MM format' })
  endTime?: string;

  @ApiPropertyOptional({ description: 'HH:MM format' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'cutoffTime must be in HH:MM format' })
  cutoffTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isExpress?: boolean;

  @ApiPropertyOptional({ type: [Number], description: '0=Sun..6=Sat' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysAvailable?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxOrders?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  extraCharge?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
