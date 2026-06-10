import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateDeliverySlotDto {
  @ApiProperty({ example: 'Morning (9am–12pm)', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  label: string;

  @ApiProperty({ example: '09:00', description: 'HH:MM format' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must be in HH:MM format' })
  startTime: string;

  @ApiProperty({ example: '12:00', description: 'HH:MM format' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must be in HH:MM format' })
  endTime: string;

  @ApiProperty({ example: '07:00', description: 'Cutoff time (HH:MM) for same-day ordering' })
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'cutoffTime must be in HH:MM format' })
  cutoffTime: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isExpress?: boolean;

  @ApiProperty({ type: [Number], example: [1, 2, 3, 4, 5], description: '0=Sun..6=Sat' })
  @IsArray()
  @ArrayUnique()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysAvailable: number[];

  @ApiProperty({ example: 50, description: 'Max orders per slot per day' })
  @IsNumber()
  @Min(1)
  maxOrders: number;

  @ApiPropertyOptional({ example: 0, description: 'Extra charge (0 for free)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  extraCharge?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
