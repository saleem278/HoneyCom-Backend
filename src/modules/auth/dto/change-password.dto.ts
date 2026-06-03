import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Used by the authenticated change-password endpoint. The user proves
 * possession of their current password before being allowed to set a new
 * one — distinct from the unauthenticated forgot-password flow which
 * relies on a one-time email token.
 */
export class ChangePasswordDto {
  @ApiProperty({ example: 'currentPassword123' })
  @IsString()
  currentPassword: string;

  @ApiProperty({ example: 'newPassword123', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
