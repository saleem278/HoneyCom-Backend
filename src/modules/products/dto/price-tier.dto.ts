import { IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PriceTierDto {
  @ApiProperty({ example: 5, description: 'Minimum quantity required for this tier (min 2)' })
  @IsNumber()
  @Min(2)
  minQty: number;

  @ApiProperty({ example: 90, description: 'Price per unit at this tier' })
  @IsNumber()
  @Min(0)
  price: number;
}
