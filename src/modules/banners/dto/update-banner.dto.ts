import { IsString, IsOptional, IsEnum, IsNumber, IsDateString, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  link?: string;

  @IsOptional()
  @IsEnum(['top', 'middle', 'bottom', 'sidebar'])
  position?: 'top' | 'middle' | 'bottom' | 'sidebar';

  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => (value !== undefined ? Number(value) : value))
  order?: number;
}
