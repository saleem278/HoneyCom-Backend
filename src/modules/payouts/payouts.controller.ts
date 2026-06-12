import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
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
import { SavePayoutMethodDto } from './dto/payout-method.dto';
import { ApprovePayoutDto, RejectPayoutDto, MarkPaidDto, RevertPayoutDto, BatchPayoutDto } from './dto/process-payout.dto';
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
  @ApiOperation({ summary: 'Get payout balance. Admin may pass ?sellerId=<id> to inspect a seller (PAY-08).' })
  async getBalance(@Request() req: AuthedRequest, @Query('sellerId') sellerId?: string) {
    return this.payoutsService.getBalance(req.user.id, req.user.role, sellerId);
  }

  /** PAY-07: Admin payout summary (counts + sums by status, paid this month) */
  @Get('summary')
  @Roles('admin')
  @ApiOperation({ summary: 'Admin payout summary: counts and sums grouped by status (PAY-07)' })
  async getSummary() {
    return this.payoutsService.getSummary();
  }

  /** PAY-03: Export payouts as JSON (client converts to CSV) */
  @Get('export')
  @Roles('admin')
  @ApiOperation({ summary: 'Export payouts filtered by status/date for CSV download (PAY-03)' })
  async exportPayouts(
    @Request() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.payoutsService.exportPayouts(req.user.role, req.user.id, status, from, to);
  }

  /** PAY-09: Get payout configuration */
  @Get('config')
  @Roles('seller', 'admin')
  @ApiOperation({ summary: 'Get payout configuration (minimum amount, fees, processing days)' })
  async getPayoutConfig() {
    return this.payoutsService.getPayoutConfig();
  }

  /** PAY-01: Saved payout methods */
  @Get('methods')
  @Roles('seller')
  @ApiOperation({ summary: 'List saved payout methods for the authenticated seller' })
  async getPayoutMethods(@Request() req: AuthedRequest) {
    return this.payoutsService.getPayoutMethods(req.user.id);
  }

  @Post('methods')
  @Roles('seller')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Save a new payout method (bank/UPI account)' })
  async savePayoutMethod(@Request() req: AuthedRequest, @Body() dto: SavePayoutMethodDto) {
    return this.payoutsService.savePayoutMethod(req.user.id, dto);
  }

  @Put('methods/:methodId')
  @Roles('seller')
  @ApiOperation({ summary: 'Update a saved payout method' })
  async updatePayoutMethod(
    @Param('methodId') methodId: string,
    @Request() req: AuthedRequest,
    @Body() dto: SavePayoutMethodDto,
  ) {
    return this.payoutsService.updatePayoutMethod(req.user.id, methodId, dto);
  }

  @Delete('methods/:methodId')
  @Roles('seller')
  @ApiOperation({ summary: 'Delete a saved payout method' })
  async deletePayoutMethod(@Param('methodId') methodId: string, @Request() req: AuthedRequest) {
    return this.payoutsService.deletePayoutMethod(req.user.id, methodId);
  }

  @Post()
  @Roles('seller')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Request a payout (accepts payoutMethodId or inline bank fields)' })
  async requestPayout(@Request() req: AuthedRequest, @Body() dto: RequestPayoutDto) {
    return this.payoutsService.requestPayout(req.user.id, dto);
  }

  @Get()
  @Roles('seller', 'admin')
  @ApiOperation({ summary: 'List payouts — seller sees own; admin sees all (paginated, searchable, date-range, sortable) PAY-11' })
  async getPayouts(
    @Request() req: AuthedRequest,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sort') sort?: string,
  ) {
    return this.payoutsService.getPayouts(
      req.user.role,
      req.user.id,
      status,
      parseInt(page || '', 10) || 1,
      parseInt(limit || '', 10) || 20,
      search,
      from,
      to,
      sort,
    );
  }

  /** PAY-11: Per-order earnings breakdown — lets a seller reconcile balance to orders.
   *  MUST be declared BEFORE @Get(':id') to avoid NestJS routing ambiguity. */
  @Get('earnings-breakdown')
  @Roles('seller', 'admin')
  @ApiOperation({ summary: 'Per-order earnings breakdown for reconciliation (PAY-11)' })
  async getEarningsBreakdown(
    @Request() req: AuthedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sellerId') sellerId?: string,
  ) {
    return this.payoutsService.getEarningsBreakdown(
      req.user.id,
      req.user.role,
      sellerId,
      from,
      to,
      parseInt(page || '', 10) || 1,
      parseInt(limit || '', 10) || 50,
    );
  }

  @Get(':id')
  @Roles('seller', 'admin')
  @ApiOperation({ summary: 'Get payout by ID' })
  async getPayoutById(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.payoutsService.getPayoutById(id, req.user.id, req.user.role);
  }

  /** PAY-03: Seller cancels a pending payout */
  @Put(':id/cancel')
  @Roles('seller')
  @ApiOperation({ summary: 'Cancel a pending payout request (seller only)' })
  async cancelPayout(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.payoutsService.cancelPayout(id, req.user.id);
  }

  @Put(':id/approve')
  @Roles('admin')
  @ApiOperation({ summary: 'Approve a payout request (admin only)' })
  async approvePayout(@Param('id') id: string, @Body() dto: ApprovePayoutDto, @Request() req: AuthedRequest) {
    return this.payoutsService.approvePayout(id, req.user.id, dto.adminNotes);
  }

  @Put(':id/reject')
  @Roles('admin')
  @ApiOperation({ summary: 'Reject a payout request (admin only)' })
  async rejectPayout(@Param('id') id: string, @Body() dto: RejectPayoutDto, @Request() req: AuthedRequest) {
    return this.payoutsService.rejectPayout(id, req.user.id, dto.rejectionReason, dto.adminNotes);
  }

  @Put(':id/mark-paid')
  @Roles('admin')
  @ApiOperation({ summary: 'Mark an approved payout as paid/transferred with transfer reference (PAY-05)' })
  async markPaid(@Param('id') id: string, @Body() dto: MarkPaidDto, @Request() req: AuthedRequest) {
    return this.payoutsService.markPaid(id, req.user.id, dto.adminNotes, dto.transferReference, dto.paymentMethod, dto.paidAt);
  }

  /** PAY-12: Revert an approved (not yet paid) payout back to pending */
  @Put(':id/revert')
  @Roles('admin')
  @ApiOperation({ summary: 'Revert an approved payout back to pending (undo mistaken approval) PAY-12' })
  async revertPayout(@Param('id') id: string, @Body() dto: RevertPayoutDto, @Request() req: AuthedRequest) {
    return this.payoutsService.revertPayout(id, req.user.id, dto.adminNotes);
  }

  /** PAY-09: Batch approve or mark-paid */
  @Post('batch')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch approve or mark-paid multiple payouts in one call (PAY-09)' })
  async batchProcess(@Body() dto: BatchPayoutDto, @Request() req: AuthedRequest) {
    return this.payoutsService.batchProcess(
      dto.ids,
      dto.action,
      req.user.id,
      dto.adminNotes,
      dto.transferReference,
      dto.paymentMethod,
    );
  }
}
