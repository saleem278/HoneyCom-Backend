import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/create-coupon.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Coupons')
@Controller('coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get all coupons' })
  @ApiResponse({ status: 200, description: 'List of coupons' })
  @Roles('admin')
  async findAll(@Query('status') status?: string, @Query('search') search?: string) {
    return this.couponsService.findAll({ status, search });
  }

  @Get(':id')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get coupon by ID' })
  @ApiResponse({ status: 200, description: 'Coupon details' })
  @Roles('admin')
  async findOne(@Param('id') id: string) {
    return this.couponsService.findOne(id);
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Create new coupon' })
  @ApiResponse({ status: 201, description: 'Coupon created' })
  @Roles('admin')
  async create(@Body() couponData: CreateCouponDto) {
    return this.couponsService.create(couponData);
  }

  @Put(':id')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Update coupon' })
  @ApiResponse({ status: 200, description: 'Coupon updated' })
  @Roles('admin')
  async update(@Param('id') id: string, @Body() couponData: UpdateCouponDto) {
    return this.couponsService.update(id, couponData);
  }

  @Delete(':id')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Delete coupon' })
  @ApiResponse({ status: 200, description: 'Coupon deleted' })
  @Roles('admin')
  async delete(@Param('id') id: string) {
    return this.couponsService.delete(id);
  }
}

