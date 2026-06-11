import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReferralService } from './referral.service';
import { ApplyReferralDto } from './dto/apply-referral.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Currency } from '../../common/decorators/currency.decorator';

@ApiTags('Referral')
@ApiBearerAuth('JWT-auth')
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('my-code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  getMyCode(@Request() req: any) {
    return this.referralService.getMyCode(req.user.id);
  }

  @Get('validate/:code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  validate(@Param('code') code: string, @Request() req: any) {
    return this.referralService.validate(code, req.user.id);
  }

  @Post('apply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  applyToCart(@Body() dto: ApplyReferralDto, @Request() req: any, @Currency() currency: string) {
    return this.referralService.applyToCart(dto.code, req.user.id, currency);
  }

  @Delete('cart')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  removeFromCart(@Request() req: any) {
    return this.referralService.removeFromCart(req.user.id);
  }

  @Get('admin/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  adminGetSettings() {
    return this.referralService.adminGetSettings();
  }

  @Post('admin/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  adminUpdateSettings(@Body() body: Record<string, string>) {
    return this.referralService.adminUpdateSettings(body);
  }

  @Get('admin/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  adminGetSummary() {
    return this.referralService.adminGetAggregateSummary();
  }

  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  adminGetStats(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.referralService.adminGetStats(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }
}
