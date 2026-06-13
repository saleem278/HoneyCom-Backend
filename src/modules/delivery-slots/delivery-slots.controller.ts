import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { DeliverySlotsService } from './delivery-slots.service';
import { CreateDeliverySlotDto } from './dto/create-delivery-slot.dto';
import { UpdateDeliverySlotDto } from './dto/update-delivery-slot.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Delivery Slots')
@Controller('delivery-slots')
export class DeliverySlotsController {
  constructor(private readonly deliverySlotsService: DeliverySlotsService) {}

  @Get()
  @ApiOperation({ summary: 'Get available delivery slots for today and tomorrow' })
  @ApiResponse({ status: 200, description: 'Available delivery slots' })
  async findAvailable() {
    return this.deliverySlotsService.findAvailable();
  }

  @Get('all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List all delivery slots incl. inactive (admin only)' })
  @ApiResponse({ status: 200, description: 'All delivery slots' })
  async findAll() {
    return this.deliverySlotsService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a delivery slot (admin only)' })
  @ApiResponse({ status: 201, description: 'Delivery slot created' })
  async create(@Body() dto: CreateDeliverySlotDto) {
    return this.deliverySlotsService.create(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a delivery slot (admin only)' })
  @ApiResponse({ status: 200, description: 'Delivery slot updated' })
  async update(@Param('id') id: string, @Body() dto: UpdateDeliverySlotDto) {
    return this.deliverySlotsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a delivery slot (admin only)' })
  @ApiResponse({ status: 200, description: 'Delivery slot deleted' })
  async remove(@Param('id') id: string) {
    return this.deliverySlotsService.remove(id);
  }
}
