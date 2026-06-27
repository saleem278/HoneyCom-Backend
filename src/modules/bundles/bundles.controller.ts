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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { BundlesService } from './bundles.service';
import { CreateBundleDto } from './dto/create-bundle.dto';
import { UpdateBundleDto } from './dto/update-bundle.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Bundles')
@Controller('bundles')
export class BundlesController {
  constructor(private readonly bundlesService: BundlesService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'List bundles (public active; seller sees own incl. inactive; admin sees all)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'seller', required: false, type: String })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: 'Seller/admin only' })
  @ApiResponse({ status: 200, description: 'Paginated bundle list' })
  async findAll(@Query() query: any, @Request() req: any) {
    const userRole: string = req?.user?.role;
    const userId: string | undefined = req?.user?.id;
    return this.bundlesService.findAll(query, userRole, userId);
  }

  @Get('by-product/:productId')
  @ApiOperation({ summary: 'Get active bundles containing a specific product' })
  @ApiResponse({ status: 200, description: 'Bundle list' })
  async findByProduct(@Param('productId') productId: string) {
    return this.bundlesService.findByProduct(productId);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Get a single bundle (inactive visible only to admin/owning seller)' })
  @ApiResponse({ status: 200, description: 'Bundle details' })
  async findOne(@Param('id') id: string, @Request() req: any) {
    return this.bundlesService.findOne(id, req?.user?.role, req?.user?.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a bundle (seller or admin)' })
  @ApiResponse({ status: 201, description: 'Bundle created' })
  async create(@Body() dto: CreateBundleDto, @Request() req: AuthedRequest) {
    return this.bundlesService.create(dto, req.user.id, req.user.role);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a bundle; sellers can only update own bundles' })
  @ApiResponse({ status: 200, description: 'Bundle updated' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBundleDto,
    @Request() req: AuthedRequest,
  ) {
    return this.bundlesService.update(id, dto, req.user.id, req.user.role);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a bundle; sellers can only delete own bundles' })
  @ApiResponse({ status: 200, description: 'Bundle deleted' })
  async remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.bundlesService.remove(id, req.user.id, req.user.role);
  }

  @Post(':id/add-to-cart')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add all bundle products to cart (qty 1 each)' })
  @ApiResponse({ status: 200, description: 'Bundle added to cart' })
  async addToCart(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.bundlesService.addToCart(id, req.user.id);
  }
}
