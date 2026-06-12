import { IsDateString, IsOptional, IsString } from 'class-validator';
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
  @ApiPropertyOptional({ description: 'Internal admin notes' })
  @IsOptional()
  @IsString()
  adminNotes?: string;

  /** PAY-05: Bank transfer reference / UTR number */
  @ApiPropertyOptional({ description: 'Bank transfer reference / UTR number' })
  @IsOptional()
  @IsString()
  transferReference?: string;

  /** PAY-05: Payment method used for disbursement (e.g. NEFT/IMPS/UPI/SWIFT) */
  @ApiPropertyOptional({ description: 'Payment method used (NEFT, IMPS, UPI, SWIFT)' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  /** PAY-05: Actual date funds were transferred */
  @ApiPropertyOptional({ description: 'Actual transfer date (ISO string)' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

/** PAY-12: Revert approved payout back to pending (undo mistaken approval) */
export class RevertPayoutDto {
  @ApiPropertyOptional({ description: 'Reason for reverting to pending' })
  @IsOptional()
  @IsString()
  adminNotes?: string;
}

/** PAY-09: Batch approve or mark-paid */
export class BatchPayoutDto {
  @ApiProperty({ description: 'List of payout IDs to process', type: [String] })
  ids: string[];

  @ApiProperty({ description: 'Action to perform: approve or mark-paid', enum: ['approve', 'mark-paid'] })
  action: 'approve' | 'mark-paid';

  @ApiPropertyOptional({ description: 'Internal admin notes applied to all items in the batch' })
  @IsOptional()
  @IsString()
  adminNotes?: string;

  /** Only used when action=mark-paid */
  @ApiPropertyOptional({ description: 'Batch transfer reference (e.g. settlement batch ID)' })
  @IsOptional()
  @IsString()
  transferReference?: string;

  @ApiPropertyOptional({ description: 'Payment method for the batch' })
  @IsOptional()
  @IsString()
  paymentMethod?: string;
}
