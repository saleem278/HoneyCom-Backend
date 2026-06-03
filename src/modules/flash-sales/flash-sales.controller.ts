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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FlashSalesService } from './flash-sales.service';
import { CreateFlashSaleDto } from './dto/create-flash-sale.dto';
import { UpdateFlashSaleDto } from './dto/update-flash-sale.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Flash Sales')
@Controller('flash-sales')
export class FlashSalesController {
  constructor(private readonly flashSalesService: FlashSalesService) {}

  @Get()
  @ApiOperation({ summary: 'List flash sales (public — active only by default)' })
  async findAll(
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.flashSalesService.findAll({
      active: active !== 'false',
      page: page ? Number(page) : 1,
      limit: limit ? Math.min(Number(limit), 50) : 20,
    });
    return { success: true, ...result };
  }

  @Get('active')
  @ApiOperation({ summary: 'Get currently active flash sales (up to 10)' })
  async getActive(@Query('limit') limit?: string) {
    const flashSales = await this.flashSalesService.getActive(limit ? Math.min(Number(limit), 20) : 10);
    return { success: true, flashSales };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single flash sale by ID' })
  async findOne(@Param('id') id: string) {
    const flashSale = await this.flashSalesService.findOne(id);
    return { success: true, flashSale };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: create a flash sale' })
  async create(@Body() dto: CreateFlashSaleDto, @Request() req: AuthedRequest) {
    const flashSale = await this.flashSalesService.create(dto, req.user.id);
    return { success: true, flashSale };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Admin: update a flash sale' })
  async update(@Param('id') id: string, @Body() dto: UpdateFlashSaleDto) {
    const flashSale = await this.flashSalesService.update(id, dto);
    return { success: true, flashSale };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Admin: delete a flash sale' })
  async remove(@Param('id') id: string) {
    await this.flashSalesService.remove(id);
  }
}
