import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Shipping address sub-object. The order service reads a mix of legacy
 * (`address`/`zipCode`) and current (`addressLine`/`postalCode`) field names,
 * so every accepted key is declared here. All optional — the service throws a
 * clear BadRequestException if a required value is missing — but they must be
 * whitelisted or `forbidNonWhitelisted` would strip/400 them.
 */
export class OrderShippingAddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() addressLine?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() state?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() zipCode?: string;
}

/**
 * A single order line item. Either `productId` or a populated `product` is
 * accepted (the service handles both). Other fields are client-provided
 * snapshots; the service re-reads authoritative price/seller from the DB.
 */
export class OrderItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productId?: string;
  // `product` may arrive as an id string or a populated object — accept either.
  @ApiPropertyOptional() @IsOptional() product?: unknown;
  @ApiProperty({ example: 1 }) @IsNumber() @Min(1) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() price?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() image?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() seller?: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() variants?: Record<string, unknown>;
}

/**
 * Create-order payload. Validates the top-level surface and the nested
 * shipping address / items. Note the controller overwrites `currency` from the
 * X-Currency header AFTER validation, so it stays optional here. Monetary
 * totals are NOT accepted from the client — the service computes them from DB
 * prices, so they are intentionally absent from this DTO.
 */
export class CreateOrderDto {
  @ApiPropertyOptional({ type: [OrderItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  @ApiPropertyOptional({ type: OrderShippingAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderShippingAddressDto)
  shippingAddress?: OrderShippingAddressDto;

  @ApiPropertyOptional({ example: 'razorpay' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  razorpayOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  razorpayPaymentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  razorpaySignature?: string;

  @ApiPropertyOptional({ example: 'INR', description: 'Overwritten by the X-Currency header' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 1.0 })
  @IsOptional()
  @IsNumber()
  exchangeRate?: number;
}
