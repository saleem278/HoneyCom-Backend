import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class ApplyReferralDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 12)
  @Matches(/^[A-Z0-9]+$/, { message: 'Referral code must be uppercase alphanumeric' })
  code: string;
}
