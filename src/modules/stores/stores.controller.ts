import { Controller, Get, Put, Body, UseGuards, Request, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AuthedRequest } from '../../common/types/request.types';

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

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'List active stores (public)' })
  @ApiResponse({ status: 200, description: 'Paginated list of active stores' })
  async getAllStores(
    @Query('city') city?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.storesService.getAllStores({
      city,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('nearby')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'List nearby active stores (best-effort, no geo data)' })
  @ApiResponse({ status: 200, description: 'List of active stores' })
  async getNearbyStores(
    @Query('city') city?: string,
    @Query('limit') limit?: string,
  ) {
    return this.storesService.getNearbyStores({
      city,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('my-store')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get my store (seller)' })
  @ApiResponse({ status: 200, description: 'Store details' })
  async getMyStore(@Request() req: AuthedRequest) {
    return this.storesService.getStoreBySeller(req.user.id);
  }

  @Put('my-store')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update my store profile' })
  @ApiResponse({ status: 200, description: 'Store updated' })
  async updateMyStore(@Request() req: AuthedRequest, @Body() updateData: any) {
    return this.storesService.updateStore(req.user.id, updateData);
  }

  @Put('my-store/settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update store settings' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  async updateStoreSettings(@Request() req: AuthedRequest, @Body() settings: any) {
    return this.storesService.updateStoreSettings(req.user.id, settings);
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: list all stores with search and status filter' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated list of all stores' })
  async adminListStores(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.storesService.adminListStores({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      status,
    });
  }

  @Put('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: activate or deactivate a store' })
  @ApiResponse({ status: 200, description: 'Store status updated' })
  async adminUpdateStoreStatus(
    @Param('id') id: string,
    @Body() body: { status: 'active' | 'inactive' },
  ) {
    return this.storesService.adminUpdateStoreStatus(id, body.status);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get store by id (public)' })
  @ApiResponse({ status: 200, description: 'Store details' })
  async getStoreById(@Param('id') id: string) {
    return this.storesService.getStoreById(id);
  }
}
