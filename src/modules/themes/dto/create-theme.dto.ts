import { IsString, IsOptional, IsBoolean, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ThemeTokensDto {
  @ApiProperty() @IsString() accent: string;
  @ApiProperty() @IsString() accentSoft: string;
  @ApiProperty() @IsString() onAccent: string;
  @ApiProperty() @IsString() bg: string;
  @ApiProperty() @IsString() card: string;
  @ApiProperty() @IsString() inputBg: string;
  @ApiProperty() @IsString() text: string;
  @ApiProperty() @IsString() sub: string;
  @ApiProperty() @IsString() muted: string;
  @ApiProperty() @IsString() border: string;
  @ApiProperty() @IsString() divider: string;
  @ApiProperty() @IsString() success: string;
  @ApiProperty() @IsString() successSoft: string;
  @ApiProperty() @IsString() danger: string;
  @ApiProperty() @IsString() dangerSoft: string;
  @ApiProperty() @IsString() info: string;
  @ApiProperty() @IsString() infoSoft: string;
  @ApiProperty() @IsString() warning: string;
  @ApiProperty() @IsString() warningSoft: string;
  @ApiProperty() @IsString() shimmer: string;
  @ApiProperty() @IsString() shimmerHighlight: string;
  @ApiProperty() @IsString() badgeBg: string;
  @ApiProperty() @IsString() badgeText: string;
}

export class CreateThemeDto {
  @ApiProperty() @IsString() name: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsObject() @ValidateNested() @Type(() => ThemeTokensDto) lightTokens: ThemeTokensDto;
  @ApiProperty() @IsObject() @ValidateNested() @Type(() => ThemeTokensDto) darkTokens: ThemeTokensDto;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
}
