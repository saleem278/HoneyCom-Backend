import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsISO8601,
  IsArray,
  MaxLength,
  Matches,
} from 'class-validator';

export class UpdatePageDto {
  @ApiPropertyOptional({ example: 'About Us' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'about-us' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens only',
  })
  slug?: string;

  @ApiPropertyOptional({ example: '<p>Updated content</p>' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({ enum: ['draft', 'published', 'scheduled'] })
  @IsOptional()
  @IsEnum(['draft', 'published', 'scheduled'])
  status?: 'draft' | 'published' | 'scheduled';

  @ApiPropertyOptional({ example: '2026-08-01T10:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  metaTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  metaDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
