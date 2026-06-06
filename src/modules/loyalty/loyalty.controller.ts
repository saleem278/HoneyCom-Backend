import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LoyaltyService } from './loyalty.service';
import { RedeemPointsDto } from './dto/redeem-points.dto';
import { AdjustPointsDto } from './dto/adjust-points.dto';
import { UpdateLoyaltySettingsDto } from './dto/update-loyalty-settings.dto';

@ApiTags('Loyalty')
@ApiBearerAuth('JWT-auth')
@Controller()
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  // ─── Customer endpoints ───────────────────────────────────────────────

  @Get('loyalty')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user loyalty balance and tier' })
  getBalance(@Request() req: any) {
    return this.loyaltyService.getBalance(req.user.id);
  }

  @Get('loyalty/transactions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get loyalty transaction history' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getTransactions(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loyaltyService.getTransactions(
      req.user.id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('loyalty/preview-redeem')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Preview discount for a points redemption (no deduction)' })
  previewRedeem(
    @Request() req: any,
    @Body() body: { points: number; orderTotal: number },
  ) {
    return this.loyaltyService.previewRedeem(req.user.id, body.points, body.orderTotal);
  }

  @Post('loyalty/redeem')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Redeem loyalty points for order discount' })
  redeem(@Request() req: any, @Body() dto: RedeemPointsDto) {
    return this.loyaltyService.redeemPoints(req.user.id, dto.points);
  }

  // ─── Admin endpoints ──────────────────────────────────────────────────

  @Get('admin/loyalty/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiOperation({ summary: 'Get loyalty program settings' })
  getSettings() {
    return this.loyaltyService.getSettings();
  }

  @Put('admin/loyalty/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiOperation({ summary: 'Update loyalty program settings' })
  updateSettings(@Body() dto: UpdateLoyaltySettingsDto) {
    return this.loyaltyService.updateSettings(dto);
  }

  @Get('admin/loyalty/users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiOperation({ summary: 'List customers with their loyalty balances' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  getUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.loyaltyService.adminGetUsers(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
    );
  }

  @Post('admin/loyalty/users/:userId/credit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Manually credit loyalty points to a user' })
  creditUser(@Param('userId') userId: string, @Body() dto: AdjustPointsDto) {
    return this.loyaltyService.adminCredit(userId, dto.points, dto.description);
  }

  @Post('admin/loyalty/users/:userId/debit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Manually debit loyalty points from a user' })
  debitUser(@Param('userId') userId: string, @Body() dto: AdjustPointsDto) {
    return this.loyaltyService.adminDebit(userId, dto.points, dto.description);
  }

  @Get('admin/loyalty/users/:userId/transactions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiOperation({ summary: 'Get loyalty transaction history for a specific user' })
  getUserTransactions(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loyaltyService.getTransactions(
      userId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }
}
