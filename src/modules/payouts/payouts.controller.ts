import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PayoutsService } from './payouts.service';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { ApprovePayoutDto, RejectPayoutDto, MarkPaidDto } from './dto/process-payout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Payouts')
@Controller('payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get('balance')
  @Roles('seller', 'admin')
  @ApiOperation({ summary: 'Get available payout balance for the authenticated seller' })
  async getBalance(@Request() req: AuthedRequest) {
    return this.payoutsService.getBalance(req.user.id);
  }

  @Post()
  @Roles('seller')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a payout (seller only)' })
  async requestPayout(
    @Request() req: AuthedRequest,
    @Body() dto: RequestPayoutDto,
  ) {
    return this.payoutsService.requestPayout(req.user.id, dto);
  }

  @Get()
  @Roles('seller', 'admin')
  @ApiOperation({ summary: 'List payouts — seller sees own; admin sees all' })
  async getPayouts(
    @Request() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.payoutsService.getPayouts(
      req.user.role,
      req.user.id,
      status,
      parseInt(page || '', 10) || 1,
      parseInt(limit || '', 10) || 20,
    );
  }

  @Get(':id')
  @Roles('seller', 'admin')
  @ApiOperation({ summary: 'Get payout by ID' })
  async getPayoutById(
    @Param('id') id: string,
    @Request() req: AuthedRequest,
  ) {
    return this.payoutsService.getPayoutById(id, req.user.id, req.user.role);
  }

  @Put(':id/approve')
  @Roles('admin')
  @ApiOperation({ summary: 'Approve a payout request (admin only)' })
  async approvePayout(
    @Param('id') id: string,
    @Body() dto: ApprovePayoutDto,
    @Request() req: AuthedRequest,
  ) {
    return this.payoutsService.approvePayout(id, req.user.id, dto.adminNotes);
  }

  @Put(':id/reject')
  @Roles('admin')
  @ApiOperation({ summary: 'Reject a payout request (admin only)' })
  async rejectPayout(
    @Param('id') id: string,
    @Body() dto: RejectPayoutDto,
    @Request() req: AuthedRequest,
  ) {
    return this.payoutsService.rejectPayout(
      id,
      req.user.id,
      dto.rejectionReason,
      dto.adminNotes,
    );
  }

  @Put(':id/mark-paid')
  @Roles('admin')
  @ApiOperation({ summary: 'Mark an approved payout as paid/transferred (admin only)' })
  async markPaid(
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
    @Request() req: AuthedRequest,
  ) {
    return this.payoutsService.markPaid(id, req.user.id, dto.adminNotes);
  }
}
