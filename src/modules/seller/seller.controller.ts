import { Controller, Get, Put, Param, Body, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SellerService } from './seller.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Seller')
@Controller('seller')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
@ApiBearerAuth('JWT-auth')
export class SellerController {
  constructor(private readonly sellerService: SellerService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get seller dashboard' })
  @ApiResponse({ status: 200, description: 'Dashboard data' })
  async getDashboard(@Request() req) {
    return this.sellerService.getDashboard(req.user.id);
  }

  @Get('products')
  @ApiOperation({ summary: 'Get seller products' })
  @ApiResponse({ status: 200, description: 'List of products' })
  async getProducts(@Request() req) {
    return this.sellerService.getProducts(req.user.id);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Get seller orders' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  async getOrders(@Request() req) {
    return this.sellerService.getOrders(req.user.id);
  }

  @Put('orders/:id/status')
  @ApiOperation({ summary: 'Update order status' })
  @ApiResponse({ status: 200, description: 'Order status updated' })
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: string; trackingNumber?: string; carrier?: string },
    @Request() req
  ) {
    return this.sellerService.updateOrderStatus(id, req.user.id, body);
  }

  @Get('reports/sales')
  @ApiOperation({ summary: 'Get sales report' })
  @ApiResponse({ status: 200, description: 'Sales report data' })
  async getSalesReport(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.sellerService.getSalesReport(req.user.id, start, end);
  }

  @Get('reports/product-performance')
  @ApiOperation({ summary: 'Get product performance report' })
  @ApiResponse({ status: 200, description: 'Product performance data' })
  async getProductPerformance(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.sellerService.getProductPerformance(req.user.id, start, end);
  }

  @Get('reports/customer-insights')
  @ApiOperation({ summary: 'Get customer insights' })
  @ApiResponse({ status: 200, description: 'Customer insights data' })
  async getCustomerInsights(@Request() req) {
    return this.sellerService.getCustomerInsights(req.user.id);
  }
}

