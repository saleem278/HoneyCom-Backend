import { Controller, Get, Put, Body, UseGuards, Request, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@ApiTags('Stores')
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get('slug/:slug')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get store by slug (public)' })
  @ApiResponse({ status: 200, description: 'Store details' })
  async getStoreBySlug(@Param('slug') slug: string) {
    return this.storesService.getStoreBySlug(slug);
  }

  @Get('my-store')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get my store (seller)' })
  @ApiResponse({ status: 200, description: 'Store details' })
  async getMyStore(@Request() req) {
    return this.storesService.getStoreBySeller(req.user.id);
  }

  @Put('my-store')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update my store profile' })
  @ApiResponse({ status: 200, description: 'Store updated' })
  async updateMyStore(@Request() req, @Body() updateData: any) {
    return this.storesService.updateStore(req.user.id, updateData);
  }

  @Put('my-store/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update store settings' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  async updateStoreSettings(@Request() req, @Body() settings: any) {
    return this.storesService.updateStoreSettings(req.user.id, settings);
  }
}

