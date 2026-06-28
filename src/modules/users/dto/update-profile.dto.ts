import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

// Only profile fields the service whitelists are accepted here. The global
// ValidationPipe (whitelist + forbidNonWhitelisted) strips/400s anything else,
// which also blocks mass-assignment attempts like { role: 'admin' }.
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'john@dayam.in' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '+1234567890' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/, { message: 'phone must be a valid phone number' })
  phone?: string;

  @ApiPropertyOptional({ example: 'https://cdn.dayam.in/avatar.png' })
  @IsOptional()
  @IsString()
  avatar?: string;
}
