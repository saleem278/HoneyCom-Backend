import { Controller, Get, Put, Param, Body, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SellerService } from './seller.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

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
  async getDashboard(@Request() req: AuthedRequest) {
    return this.sellerService.getDashboard(req.user.id);
  }

  /** SP-13/SP-14: Aggregate stats. MUST be declared before @Get('products') so NestJS
   *  doesn't match the literal string "stats" as a :id dynamic segment. */
  @Get('products/stats')
  @ApiOperation({ summary: 'Get seller product stats' })
  @ApiResponse({ status: 200, description: 'Aggregated product counts' })
  async getProductStats(@Request() req: AuthedRequest) {
    return this.sellerService.getProductStats(req.user.id);
  }

  @Get('products')
  @ApiOperation({ summary: 'Get seller products' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiResponse({ status: 200, description: 'List of products' })
  async getProducts(
    @Request() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = parseInt(page || '', 10) || 1;
    const limitNum = parseInt(limit || '', 10) || 20;
    return this.sellerService.getProducts(req.user.id, pageNum, limitNum, search, status);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Get seller orders' })
  @ApiQuery({ name: 'status', required: false, type: String, description: 'Filter by order status' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by order number or customer name/email' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  async getOrders(
    @Request() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = parseInt(page || '', 10) || 1;
    const limitNum = parseInt(limit || '', 10) || 20;
    return this.sellerService.getOrders(req.user.id, pageNum, limitNum, status, search);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Get seller order by ID' })
  @ApiResponse({ status: 200, description: 'Order details' })
  async getOrderById(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.sellerService.getOrderById(id, req.user.id);
  }

  @Put('orders/:id/status')
  @ApiOperation({ summary: 'Update order status' })
  @ApiResponse({ status: 200, description: 'Order status updated' })
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: string; trackingNumber?: string; carrier?: string; estimatedDelivery?: string; notes?: string },
    @Request() req: AuthedRequest,
  ) {
    return this.sellerService.updateOrderStatus(id, req.user.id, body);
  }

  @Get('reports/sales')
  @ApiOperation({ summary: 'Get sales report' })
  @ApiResponse({ status: 200, description: 'Sales report data' })
  async getSalesReport(
    @Request() req: AuthedRequest,
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
    @Request() req: AuthedRequest,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.sellerService.getProductPerformance(req.user.id, start, end);
  }

  @Get('reports/customer-insights')
  @ApiOperation({ summary: 'Get customer insights' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Customer insights data' })
  async getCustomerInsights(
    @Request() req: AuthedRequest,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    // SDA-08: date range so sellers can answer "who were my top buyers last quarter"
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.sellerService.getCustomerInsights(req.user.id, start, end);
  }
}

