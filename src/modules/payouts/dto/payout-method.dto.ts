import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** PAY-01: DTO for creating / updating a saved payout method */
export class SavePayoutMethodDto {
  @ApiPropertyOptional({ description: 'Friendly label for this method, e.g. "SBI Savings"' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ description: 'Account holder name' })
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

  @ApiPropertyOptional({ description: 'IFSC code (India domestic)' })
  @IsOptional()
  @IsString()
  ifscCode?: string;

  @ApiPropertyOptional({ description: 'SWIFT/BIC code (international)' })
  @IsOptional()
  @IsString()
  swiftCode?: string;

  @ApiPropertyOptional({ description: 'UPI ID' })
  @IsOptional()
  @IsString()
  upiId?: string;

  @ApiPropertyOptional({ description: 'Set as default payout method' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
