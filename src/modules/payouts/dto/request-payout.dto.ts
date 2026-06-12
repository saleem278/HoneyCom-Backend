import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestPayoutDto {
  @ApiProperty({ description: 'Payout amount (must be >= minimum and <= available balance)' })
  @IsNumber()
  @Min(1)
  amount: number;

  /** PAY-01: When provided, the service snapshots the saved method bank details */
  @ApiPropertyOptional({ description: 'ID of a saved payout method. When provided, inline bank fields are not required.' })
  @IsOptional()
  @IsString()
  payoutMethodId?: string;

  @ApiPropertyOptional({ description: 'Bank account holder name (required when payoutMethodId absent)' })
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional({ description: 'Bank account number (required when payoutMethodId absent)' })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional({ description: 'Bank name (required when payoutMethodId absent)' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ description: 'IFSC code (India domestic transfers)' })
  @IsOptional()
  @IsString()
  ifscCode?: string;

  @ApiPropertyOptional({ description: 'SWIFT/BIC code (international transfers)' })
  @IsOptional()
  @IsString()
  swiftCode?: string;

  @ApiPropertyOptional({ description: 'UPI ID (India instant transfers)' })
  @IsOptional()
  @IsString()
  upiId?: string;

  @ApiPropertyOptional({ description: 'Optional notes for the admin' })
  @IsOptional()
  @IsString()
  notes?: string;
}
