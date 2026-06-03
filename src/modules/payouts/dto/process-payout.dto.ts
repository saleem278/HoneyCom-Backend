import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApprovePayoutDto {
  @ApiPropertyOptional({ description: 'Internal admin notes' })
  @IsOptional()
  @IsString()
  adminNotes?: string;
}

export class RejectPayoutDto {
  @ApiProperty({ description: 'Reason shown to the seller' })
  @IsString()
  rejectionReason: string;

  @ApiPropertyOptional({ description: 'Internal admin notes' })
  @IsOptional()
  @IsString()
  adminNotes?: string;
}

export class MarkPaidDto {
  @ApiPropertyOptional({ description: 'Internal admin notes (e.g. transfer reference)' })
  @IsOptional()
  @IsString()
  adminNotes?: string;
}
