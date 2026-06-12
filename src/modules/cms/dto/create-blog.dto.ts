import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsISO8601,
  IsArray,
  IsMongoId,
  IsUrl,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateBlogDto {
  @ApiProperty({ example: 'Top 10 Selling Tips' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ example: 'top-10-selling-tips', description: 'Auto-generated from title when omitted' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase alphanumeric with hyphens only',
  })
  slug?: string;

  @ApiProperty({ example: '<p>Content here</p>' })
  @IsString()
  content: string;

  @ApiPropertyOptional({ example: 'A quick overview of the top tips.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  excerpt?: string;

  @ApiPropertyOptional({ example: 'https://example.com/image.jpg' })
  @IsOptional()
  @IsString()
  featuredImage?: string;

  @ApiPropertyOptional({ example: '64f1a2b3c4d5e6f7a8b9c0d1' })
  @IsOptional()
  @IsMongoId()
  category?: string;

  @ApiPropertyOptional({ example: ['selling', 'tips', 'ecommerce'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: ['draft', 'published', 'scheduled'], default: 'draft' })
  @IsOptional()
  @IsEnum(['draft', 'published', 'scheduled'])
  status?: 'draft' | 'published' | 'scheduled';

  @ApiPropertyOptional({ example: '2026-08-01T10:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @ApiPropertyOptional({ example: 'Top 10 Selling Tips | HoneyCom' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  metaTitle?: string;

  @ApiPropertyOptional({ example: 'Read our top 10 selling tips to boost your revenue.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  metaDescription?: string;

  @ApiPropertyOptional({ example: ['selling', 'tips'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
