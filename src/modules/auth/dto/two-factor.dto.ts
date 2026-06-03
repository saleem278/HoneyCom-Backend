import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class Verify2FADto {
  @ApiProperty({ example: '123456', description: '6-digit TOTP code' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code: string;
}

export class Disable2FADto {
  @ApiProperty({ example: 'currentPassword123' })
  @IsString()
  currentPassword: string;
}

export class Login2FADto {
  @ApiProperty({ description: 'Short-lived challenge token returned by /auth/login' })
  @IsString()
  twoFactorChallenge: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit TOTP code OR a recovery code (e.g. 7K3M-9XQR-4PWV-2NBC)',
  })
  @IsString()
  code: string;
}
