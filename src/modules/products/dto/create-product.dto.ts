import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PriceTierDto } from './price-tier.dto';

export class CreateProductDto {
  @ApiPropertyOptional({
    type: [PriceTierDto],
    description: 'Wholesale/tiered pricing tiers. Each tier defines a minimum quantity and price.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceTierDto)
  priceTiers?: PriceTierDto[];
}
