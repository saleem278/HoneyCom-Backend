import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional, Matches } from 'class-validator';

// `role` is intentionally absent — self-registration always creates customers.
// Sellers use /auth/register/seller; admins are provisioned by existing admins.
export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'john@dayam.in' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: '+1234567890', required: false })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'phone must be a valid phone number' })
  phone?: string;
}

