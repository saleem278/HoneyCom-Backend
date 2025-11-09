import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Settings')
@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth('JWT-auth')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all settings (admin)' })
  @ApiResponse({ status: 200, description: 'All settings' })
  async getAll(@Query('category') category?: string) {
    if (category) {
      return this.settingsService.getByCategory(category);
    }
    return this.settingsService.getAll();
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get setting by key' })
  @ApiResponse({ status: 200, description: 'Setting value' })
  async getByKey(@Param('key') key: string) {
    return this.settingsService.getByKey(key);
  }

  @Post()
  @ApiOperation({ summary: 'Set a setting' })
  @ApiResponse({ status: 200, description: 'Setting saved' })
  async set(@Body() body: { key: string; value: any; category: string; description?: string }) {
    return this.settingsService.set(body.key, body.value, body.category, body.description);
  }

  @Put('bulk')
  @ApiOperation({ summary: 'Set multiple settings' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  async setMultiple(@Body() body: { settings: Array<{ key: string; value: any; category: string; description?: string }> }) {
    return this.settingsService.setMultiple(body.settings);
  }

  @Delete(':key')
  @ApiOperation({ summary: 'Delete a setting' })
  @ApiResponse({ status: 200, description: 'Setting deleted' })
  async delete(@Param('key') key: string) {
    return this.settingsService.delete(key);
  }
}

