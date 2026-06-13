import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

/**
 * Create-email-template payload. The global ValidationPipe runs with
 * whitelist + forbidNonWhitelisted, so every accepted field is declared here.
 */
export class CreateEmailTemplateDto {
  @ApiProperty({ example: 'orderConfirm', description: 'Stable key the mailer resolves by' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ example: 'Order Confirmation' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Your order #{{orderNumber}} is confirmed!' })
  @IsString()
  @IsNotEmpty()
  subject: string;

  @ApiPropertyOptional({ example: 'Track My Order' })
  @IsOptional()
  @IsString()
  cta?: string;

  @ApiPropertyOptional({ example: "Thank you for your order! Here's a summary." })
  @IsOptional()
  @IsString()
  intro?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Update payload - every field optional. */
export class UpdateEmailTemplateDto extends PartialType(CreateEmailTemplateDto) {}
