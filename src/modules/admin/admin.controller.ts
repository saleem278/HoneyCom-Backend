import { Controller, Get, Put, Param, Body, UseGuards, Request, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

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
  async getUsers() {
    return this.adminService.getUsers();
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
  async updateUserStatus(@Param('id') id: string, @Body() body: { status: string }) {
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
}

