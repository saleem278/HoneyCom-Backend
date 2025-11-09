import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Currency } from '../../common/decorators/currency.decorator';

@ApiTags('Orders')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create new order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  async create(@Request() req, @Body() orderData: any, @Currency() currency: string) {
    // Override currency from body with header currency (header takes priority)
    orderData.currency = currency;
    return this.ordersService.create(req.user.id, orderData);
  }

  @Get()
  @ApiOperation({ summary: 'Get all orders' })
  @ApiResponse({ status: 200, description: 'List of orders' })
  async findAll(@Request() req) {
    return this.ordersService.findAll(req.user.id, req.user.role);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({ status: 200, description: 'Order details' })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.ordersService.findOne(id, req.user.id, req.user.role);
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: 'Cancel order' })
  @ApiResponse({ status: 200, description: 'Order cancelled' })
  async cancel(@Param('id') id: string, @Request() req) {
    return this.ordersService.cancel(id, req.user.id, req.user.role);
  }

  @Post(':id/return')
  @ApiOperation({ summary: 'Request order return' })
  @ApiResponse({ status: 200, description: 'Return request submitted' })
  async requestReturn(@Param('id') id: string, @Body() body: any, @Request() req) {
    return this.ordersService.requestReturn(id, req.user.id, body);
  }

  @Get(':id/track')
  @ApiOperation({ summary: 'Track order' })
  @ApiResponse({ status: 200, description: 'Order tracking information' })
  async track(@Param('id') id: string, @Request() req) {
    return this.ordersService.track(id, req.user.id, req.user.role);
  }

  @Get(':id/invoice')
  @ApiOperation({ summary: 'Generate invoice for order' })
  @ApiResponse({ status: 200, description: 'Invoice data' })
  async getInvoice(@Param('id') id: string, @Request() req) {
    return this.ordersService.generateInvoice(id, req.user.id, req.user.role);
  }

  @Get(':id/shipping-label')
  @ApiOperation({ summary: 'Generate shipping label for order' })
  @ApiResponse({ status: 200, description: 'Shipping label PDF' })
  async getShippingLabel(@Param('id') id: string, @Request() req) {
    return this.ordersService.generateShippingLabel(id, req.user.id, req.user.role);
  }
}

