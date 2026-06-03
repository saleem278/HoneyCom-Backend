import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestPayoutDto {
  @ApiProperty({ description: 'Payout amount (must be ≤ available balance)' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Bank account holder name' })
  @IsString()
  @IsNotEmpty()
  bankAccountName: string;

  @ApiProperty({ description: 'Bank account number' })
  @IsString()
  @IsNotEmpty()
  bankAccountNumber: string;

  @ApiProperty({ description: 'Bank name' })
  @IsString()
  @IsNotEmpty()
  bankName: string;

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
