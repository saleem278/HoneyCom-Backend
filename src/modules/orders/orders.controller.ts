import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Currency } from '../../common/decorators/currency.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Create new order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  async create(@Request() req: AuthedRequest, @Body() orderData: CreateOrderDto, @Currency() currency: string) {
    // Override currency from body with header currency (header takes priority)
    orderData.currency = currency;
    return this.ordersService.create(req.user.id, orderData);
  }

  @Get()
  @ApiOperation({ summary: 'Get all orders' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  async findAll(@Request() req: AuthedRequest, @Query('page') page?: string, @Query('limit') limit?: string, @Query('status') status?: string) {
    const pageNum = parseInt(page || '', 10) || 1;
    const limitNum = parseInt(limit || '', 10) || 20;
    return this.ordersService.findAll(req.user.id, req.user.role, pageNum, limitNum, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({ status: 200, description: 'Order details' })
  async findOne(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ordersService.findOne(id, req.user.id, req.user.role);
  }

  @Put(':id/cancel')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Cancel order' })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  async cancel(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ordersService.cancel(id, req.user.id, req.user.role);
  }

  @Post(':id/return')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Request order return' })
  @ApiResponse({ status: 200, description: 'Return request submitted' })
  async requestReturn(@Param('id') id: string, @Body() body: any, @Request() req: AuthedRequest) {
    return this.ordersService.requestReturn(id, req.user.id, body);
  }

  @Get(':id/track')
  @ApiOperation({ summary: 'Track order' })
  @ApiResponse({ status: 200, description: 'Order tracking information' })
  async track(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ordersService.track(id, req.user.id, req.user.role);
  }

  @Get(':id/invoice')
  @ApiOperation({ summary: 'Generate invoice for order' })
  @ApiResponse({ status: 200, description: 'Invoice PDF or URL' })
  async getInvoice(
    @Param('id') id: string,
    @Request() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const result = await this.ordersService.generateInvoice(id, req.user.id, req.user.role);

    // When Cloudinary is configured the service returns a public URL — let
    // the frontend open it directly.
    if (result.pdfUrl) {
      return res.json({ success: true, invoice: result.invoice, pdfUrl: result.pdfUrl });
    }

    // Cloudinary not configured or upload failed — stream the PDF buffer
    // directly so the download still works in local/dev without needing
    // Cloudinary credentials.
    if (result.pdfBuffer) {
      const filename = `invoice-${result.invoice.invoiceNumber || id}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', result.pdfBuffer.length);
      return res.send(result.pdfBuffer);
    }

    return res.json({ success: true, invoice: result.invoice, pdfUrl: null });
  }

  @Get(':id/shipping-label')
  @ApiOperation({ summary: 'Generate shipping label for order' })
  @ApiResponse({ status: 200, description: 'Shipping label PDF' })
  async getShippingLabel(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.ordersService.generateShippingLabel(id, req.user.id, req.user.role);
  }
}
