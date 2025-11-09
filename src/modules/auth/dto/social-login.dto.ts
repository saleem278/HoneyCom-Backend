import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEnum } from 'class-validator';

export class SocialLoginDto {
  @ApiProperty({ enum: ['google', 'facebook'], example: 'google' })
  @IsEnum(['google', 'facebook'])
  provider: string;

  @ApiProperty({ example: 'authorization_code_from_oauth' })
  @IsString()
  code: string;
}

