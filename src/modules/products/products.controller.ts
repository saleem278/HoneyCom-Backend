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
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Currency } from '../../common/decorators/currency.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get all products' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'minPrice', required: false, type: Number })
  @ApiQuery({ name: 'maxPrice', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'featured', required: false, type: Boolean })
  @ApiQuery({ name: 'sort', required: false, enum: ['price_asc', 'price_desc', 'rating', 'newest', 'popular', 'discount'] })
  @ApiQuery({ name: 'seller', required: false, type: String, description: 'Filter by seller ID (public storefront)' })
  @ApiResponse({ status: 200, description: 'List of products' })
  async findAll(@Query() query: any, @Request() req: any, @Currency() currency: string) {
    // Treat unauthenticated requests as 'customer' so the service always
    // receives a defined role and falls into the "approved products only" branch.
    const userRole: string = req?.user?.role ?? 'customer';
    const userId: string | undefined = req?.user?.id;
    return this.productsService.findAll(query, userRole, userId, currency);
  }

  @Get('alerts/my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get my product alert subscriptions' })
  @ApiResponse({ status: 200, description: 'List of alert subscriptions' })
  async getMyAlerts(@Request() req: AuthedRequest) {
    return this.productsService.getMyAlerts(req.user.id);
  }

  @Get(':id/alerts/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get alert subscription status for a product' })
  @ApiResponse({ status: 200, description: 'Alert subscription status' })
  async getAlertStatus(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.productsService.getAlertStatus(id, req.user.id);
  }

  @Post(':id/alerts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Subscribe to a product alert' })
  @ApiResponse({ status: 201, description: 'Alert subscription created' })
  async subscribeAlert(
    @Param('id') id: string,
    @Body() body: { type: 'price_drop' | 'back_in_stock'; targetPrice?: number },
    @Request() req: AuthedRequest,
  ) {
    return this.productsService.subscribeAlert(id, req.user.id, body.type, body.targetPrice);
  }

  @Delete(':id/alerts/:type')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsubscribe from a product alert' })
  @ApiResponse({ status: 200, description: 'Alert removed' })
  async unsubscribeAlert(
    @Param('id') id: string,
    @Param('type') type: 'price_drop' | 'back_in_stock',
    @Request() req: AuthedRequest,
  ) {
    return this.productsService.unsubscribeAlert(id, req.user.id, type);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiResponse({ status: 200, description: 'Product details' })
  async findOne(@Param('id') id: string, @Currency() currency: string, @Request() req: any) {
    return this.productsService.findOne(id, currency, req?.user?.role, req?.user?.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create product' })
  @ApiResponse({ status: 201, description: 'Product created' })
  async create(@Request() req: AuthedRequest, @Body() createProductDto: any) {
    return this.productsService.create(createProductDto, req.user.id);
  }

  @Post('bulk-upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk upload products from CSV' })
  @ApiResponse({ status: 201, description: 'Products uploaded' })
  async bulkUpload(@Request() req: AuthedRequest, @UploadedFile() file: Express.Multer.File) {
    return this.productsService.bulkUpload(file, req.user.id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update product' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  async update(@Param('id') id: string, @Request() req: AuthedRequest, @Body() updateProductDto: any) {
    return this.productsService.update(id, updateProductDto, req.user.id, req.user.role);
  }

  @Put(':id/inventory')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update product inventory' })
  @ApiResponse({ status: 200, description: 'Inventory updated' })
  async updateInventory(@Param('id') id: string, @Request() req: AuthedRequest, @Body() body: { inventory: number }) {
    return this.productsService.updateInventory(id, body.inventory, req.user.id, req.user.role);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete product' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  async remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.productsService.remove(id, req.user.id, req.user.role);
  }

  @Post(':id/questions')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Ask a question about a product' })
  @ApiResponse({ status: 200, description: 'Question submitted' })
  async askQuestion(
    @Param('id') id: string,
    @Body() body: { question: string; customerEmail?: string },
    @Request() req: any,
  ) {
    // Prefer the verified email from the JWT over any client-supplied email.
    const email = req.user?.email ?? body.customerEmail;
    return this.productsService.askQuestion(id, body.question, email);
  }
}

