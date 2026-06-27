import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

// E.164-ish phone format: optional leading +, first digit 1-9, then 7-14 more digits.
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class RequestPhoneOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @IsNotEmpty()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone: string;
}

export class VerifyPhoneOtpDto {
  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @IsNotEmpty()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @IsNotEmpty()
  otp: string;
}


