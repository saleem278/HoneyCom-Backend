import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MobileService } from './mobile.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Mobile')
@Controller('mobile')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class MobileController {
  constructor(private readonly mobileService: MobileService) {}

  // ========== DEVICES ==========
  @Post('devices')
  @ApiOperation({ summary: 'Register device for push notifications' })
  @ApiResponse({ status: 200, description: 'Device registered' })
  async registerDevice(@Body() body: { deviceToken: string; platform: 'ios' | 'android'; appVersion: string }, @Request() req) {
    return this.mobileService.registerDevice(req.user.id, body);
  }

  @Get('devices')
  @ApiOperation({ summary: 'Get user devices' })
  @ApiResponse({ status: 200, description: 'List of devices' })
  async getUserDevices(@Request() req) {
    return this.mobileService.getUserDevices(req.user.id);
  }

  @Delete('devices/:id')
  @ApiOperation({ summary: 'Unregister device' })
  @ApiResponse({ status: 200, description: 'Device unregistered' })
  async unregisterDevice(@Param('id') id: string, @Request() req) {
    return this.mobileService.unregisterDevice(id, req.user.id);
  }

  // ========== NOTIFICATIONS ==========
  @Get('notifications')
  @ApiOperation({ summary: 'Get user notifications' })
  @ApiResponse({ status: 200, description: 'List of notifications' })
  async getNotifications(@Request() req, @Body() body?: { page?: number; limit?: number }) {
    return this.mobileService.getNotifications(req.user.id, body?.page, body?.limit);
  }

  @Put('notifications/:id/read')
  @ApiOperation({ summary: 'Mark notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markAsRead(@Param('id') id: string, @Request() req) {
    return this.mobileService.markAsRead(id, req.user.id);
  }

  @Put('notifications/read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  async markAllAsRead(@Request() req) {
    return this.mobileService.markAllAsRead(req.user.id);
  }

  @Delete('notifications/:id')
  @ApiOperation({ summary: 'Delete notification' })
  @ApiResponse({ status: 200, description: 'Notification deleted' })
  async deleteNotification(@Param('id') id: string, @Request() req) {
    return this.mobileService.deleteNotification(id, req.user.id);
  }
}

