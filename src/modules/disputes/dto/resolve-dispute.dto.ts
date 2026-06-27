import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Payload for resolving a dispute (admin only). The global ValidationPipe runs
 * whitelist + forbidNonWhitelisted + transform, so declaring the surface here
 * auto-rejects unknown keys and coerces/validates the refund amount.
 */
export class ResolveDisputeDto {
  @ApiProperty({
    enum: ['refund', 'partial_refund', 'replacement', 'no_action', 'other'],
    description: 'How the dispute is being resolved',
  })
  @IsIn(['refund', 'partial_refund', 'replacement', 'no_action', 'other'])
  resolution: 'refund' | 'partial_refund' | 'replacement' | 'no_action' | 'other';

  @ApiPropertyOptional({
    example: 499.0,
    description: 'Refund amount (required for partial_refund; defaults to the remaining balance for a full refund)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  refundAmount?: number;

  @ApiPropertyOptional({ description: 'Resolution notes shown to the customer/seller' })
  @IsOptional()
  @IsString()
  notes?: string;
}
