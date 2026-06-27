import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get all categories (admin sees all; public sees active only)' })
  @ApiQuery({ name: 'featured', required: false, type: Boolean })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiQuery({ name: 'withCounts', required: false, type: Boolean, description: 'Include product counts per category' })
  @ApiResponse({ status: 200, description: 'List of categories' })
  async findAll(
    @Query('featured') featured?: string,
    @Query('status') status?: string,
    @Query('withCounts') withCounts?: string,
    @Req() req?: Request,
  ) {
    const isAdmin = (req as any)?.user?.role === 'admin';
    return this.categoriesService.findAll({ featured, status, withCounts }, isAdmin);
  }

  @Get('slug/:slug')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get category by slug' })
  @ApiResponse({ status: 200, description: 'Category details' })
  async findBySlug(@Param('slug') slug: string, @Req() req?: Request) {
    const isAdmin = (req as any)?.user?.role === 'admin';
    return this.categoriesService.findBySlug(slug, isAdmin);
  }

  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get category by ID' })
  @ApiResponse({ status: 200, description: 'Category details' })
  async findOne(@Param('id') id: string, @Req() req?: Request) {
    const isAdmin = (req as any)?.user?.role === 'admin';
    return this.categoriesService.findOne(id, isAdmin);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Create category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  async create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Update category' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  async update(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
    return this.categoriesService.update(id, updateCategoryDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Delete category' })
  @ApiResponse({ status: 200, description: 'Category deleted' })
  async remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}

