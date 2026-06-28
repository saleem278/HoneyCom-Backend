import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class SellerDocumentsDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  businessLicense?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  taxDocument?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  idDocument?: string;
}

/**
 * Seller-registration payload. Was previously typed as `any` on the
 * controller, which silently disabled the global ValidationPipe — any
 * field the client sent reached the service unchecked. With the DTO in
 * place, whitelist + forbidNonWhitelisted strip / reject unknown keys,
 * documents URLs are validated as real URLs (so we don't accept
 * `javascript:` or relative paths), and password length is enforced
 * before bcrypt is touched.
 */
export class RegisterSellerDto {
  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ example: 'jane@dayam.in' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: '+1234567890', required: false })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'Acme Co.', required: false })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiProperty({ example: '221B Baker Street, London', required: false })
  @IsOptional()
  @IsString()
  businessAddress?: string;

  @ApiProperty({ example: 'GB123456789', required: false })
  @IsOptional()
  @IsString()
  taxId?: string;

  @ApiProperty({ required: false, type: () => SellerDocumentsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SellerDocumentsDto)
  documents?: SellerDocumentsDto;
}
