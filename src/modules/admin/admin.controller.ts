import { Controller, Get, Put, Param, Body, UseGuards, Request, Post, Query, Res, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { AuthedRequest } from '../../common/types/request.types';
import { SESSION_COOKIE_NAME, ADMIN_STASH_COOKIE_NAME } from '../auth/strategies/jwt.strategy';
import {
  sessionCookieOptions,
  clearSessionCookieOptions,
} from '../../common/utils/cookie-options';

@ApiTags('Admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth('JWT-auth')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get admin dashboard' })
  @ApiResponse({ status: 200, description: 'Dashboard data' })
  async getDashboard() {
    return this.adminService.getDashboard();
  }

  @Get('users')
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of users' })
  async getUsers(@Query('page') page?: string, @Query('limit') limit?: string) {
    const pageNum = parseInt(page || '', 10) || 1;
    const limitNum = parseInt(limit || '', 10) || 20;
    return this.adminService.getUsers(pageNum, limitNum);
  }

  @Put('products/:id/approve')
  @ApiOperation({ summary: 'Approve product' })
  @ApiResponse({ status: 200, description: 'Product approved' })
  async approveProduct(@Param('id') id: string) {
    return this.adminService.approveProduct(id);
  }

  @Put('products/:id/reject')
  @ApiOperation({ summary: 'Reject product' })
  @ApiResponse({ status: 200, description: 'Product rejected' })
  async rejectProduct(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.adminService.rejectProduct(id, body.reason);
  }

  @Put('users/:id/status')
  @ApiOperation({ summary: 'Update user status (suspend/unsuspend)' })
  @ApiResponse({ status: 200, description: 'User status updated' })
  async updateUserStatus(@Param('id') id: string, @Body() body: { status: 'active' | 'inactive' | 'suspended' }) {
    return this.adminService.updateUserStatus(id, body.status);
  }

  @Post('orders/:id/refund')
  @ApiOperation({ summary: 'Process refund for order' })
  @ApiResponse({ status: 200, description: 'Refund processed successfully' })
  async processRefund(@Param('id') id: string, @Body() body: { amount?: number; reason: string }) {
    return this.adminService.processRefund(id, body.amount, body.reason);
  }

  @Get('sellers/pending')
  @ApiOperation({ summary: 'Get pending seller registrations' })
  @ApiResponse({ status: 200, description: 'List of pending sellers' })
  async getPendingSellers() {
    return this.adminService.getPendingSellers();
  }

  @Put('sellers/:id/approve')
  @ApiOperation({ summary: 'Approve seller registration' })
  @ApiResponse({ status: 200, description: 'Seller approved' })
  async approveSeller(@Param('id') id: string) {
    return this.adminService.approveSeller(id);
  }

  @Put('sellers/:id/reject')
  @ApiOperation({ summary: 'Reject seller registration' })
  @ApiResponse({ status: 200, description: 'Seller rejected' })
  async rejectSeller(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.adminService.rejectSeller(id, body.reason);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get user details with orders and activity' })
  @ApiResponse({ status: 200, description: 'User details' })
  async getUserDetails(@Param('id') id: string) {
    return this.adminService.getUserDetails(id);
  }

  @Get('analytics')
  @ApiOperation({ summary: 'Get platform analytics' })
  @ApiResponse({ status: 200, description: 'Platform analytics data' })
  async getPlatformAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.adminService.getPlatformAnalytics(start, end);
  }

  @Get('reports/financial')
  @ApiOperation({ summary: 'Get financial report' })
  @ApiResponse({ status: 200, description: 'Financial report data' })
  async getFinancialReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.adminService.getFinancialReport(start, end);
  }

  // -------- Impersonation --------
  // All three endpoints inherit the class-level @Roles('admin'). Plus
  // the service-level guard refuses to impersonate other admins, so a
  // chain-of-trust violation can't be forged from the controller layer.
  //
  // ROUTE ORDER MATTERS: the literal `impersonate/end` route must be
  // declared before the dynamic `impersonate/:userId` route, otherwise
  // Nest matches /impersonate/end as userId="end" and the "End session"
  // call lands in startImpersonation (which then 400s on the missing
  // reason). Same reason `impersonate/audit` is declared above the
  // dynamic route.

  @Post('impersonate/end')
  @ApiOperation({ summary: 'End the current impersonation session' })
  @ApiResponse({ status: 200, description: 'Session closed' })
  async endImpersonation(
    @Request() req: AuthedRequest,
    @Body() body: { eventId: string },
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    // Caller must currently be impersonating, AND the session being
    // closed must belong to *their* impersonator id (the JWT's
    // impersonator claim). The service double-checks the latter.
    if (!req.user.impersonator) {
      throw new ForbiddenException('No active impersonation session');
    }
    const expressReq = req as unknown as ExpressRequest;
    const stashed = expressReq.cookies?.[ADMIN_STASH_COOKIE_NAME];
    if (!stashed) {
      throw new BadRequestException('No stashed admin session — cannot restore. Sign in again.');
    }

    const result = await this.adminService.endImpersonation(body.eventId, req.user.impersonator);

    // Restore the admin's original session cookie and clear the stash.
    res.cookie(SESSION_COOKIE_NAME, stashed, sessionCookieOptions(30 * 24 * 60 * 60 * 1000));
    // clearCookie must mirror the same SameSite/Secure as the original
    // Set-Cookie or the browser keeps the original around in prod.
    res.clearCookie(ADMIN_STASH_COOKIE_NAME, clearSessionCookieOptions());

    return result;
  }

  @Post('impersonate/:userId')
  @ApiOperation({ summary: 'Start impersonating a user (audit logged)' })
  @ApiResponse({ status: 200, description: 'Impersonation token issued' })
  async startImpersonation(
    @Request() req: AuthedRequest,
    @Param('userId') userId: string,
    @Body() body: { reason: string },
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    // Reject if the caller is themselves already in an impersonation
    // session — nesting would make the audit trail ambiguous and serves
    // no support workflow.
    if (req.user.impersonator) {
      throw new ForbiddenException('End the current impersonation session before starting a new one');
    }
    const expressReq = req as unknown as ExpressRequest;
    // Prefer the existing session cookie (the common case). Fall back to
    // the Authorization bearer token when the admin authenticated
    // header-only — incognito windows in production block third-party
    // cookies, so the admin portal frequently runs in bearer-only mode.
    // Either way, the admin's token gets stashed under
    // ADMIN_STASH_COOKIE_NAME and restored on /impersonate/end. The new
    // session cookie we set below will take over on subsequent requests
    // because the JwtStrategy reads cookie before Authorization.
    const adminCookie =
      expressReq.cookies?.[SESSION_COOKIE_NAME] ||
      (() => {
        const authHeader = req.headers['authorization'];
        if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
          return authHeader.slice(7).trim();
        }
        return undefined;
      })();
    if (!adminCookie) {
      throw new BadRequestException('Admin session not found — sign in again');
    }

    const ip = expressReq.ip || expressReq.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const result = await this.adminService.startImpersonation(req.user.id, userId, body.reason, ip, userAgent);

    // Stash the admin's existing session cookie under a separate name,
    // then overwrite the active session cookie with the impersonation
    // token. Both cookies are HttpOnly so JS can't see either; the
    // backend reads the stash on /impersonate/end to restore.
    // Match the admin's original cookie expiry conservatively.
    res.cookie(ADMIN_STASH_COOKIE_NAME, adminCookie, sessionCookieOptions(30 * 24 * 60 * 60 * 1000));
    // 1h, matches the impersonation JWT's exp
    res.cookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(60 * 60 * 1000));

    return result;
  }

  @Get('impersonate/audit')
  @ApiOperation({ summary: 'Recent impersonation activity (own by default; viewAll=true for everyone)' })
  @ApiResponse({ status: 200, description: 'Impersonation audit log' })
  async listImpersonations(
    @Request() req: AuthedRequest,
    @Query('viewAll') viewAll?: string,
    @Query('limit') limit?: string,
  ) {
    const showEveryone = viewAll === 'true';
    const limitNum = parseInt(limit || '', 10) || 50;
    return this.adminService.listImpersonations(req.user.id, showEveryone, limitNum);
  }
}

