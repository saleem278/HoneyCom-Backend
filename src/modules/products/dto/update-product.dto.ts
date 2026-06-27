import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

/**
 * Update-product payload. Every field optional (PATCH-like semantics). Because
 * the global ValidationPipe runs with `whitelist + forbidNonWhitelisted`, every
 * field a client may legitimately send is declared here (inherited from
 * CreateProductDto via PartialType, plus `rejectionReason` below).
 *
 * SECURITY: the service's `update()` re-whitelists fields per role — sellers may
 * not self-approve, change `seller`, or override `rating`/`numReviews`/
 * `rejectionReason`. Declaring a field here only means the request validates;
 * the service decides which role may actually persist it.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional({
    description: 'Admin-only. Reason shown to the seller when a product is rejected.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}
