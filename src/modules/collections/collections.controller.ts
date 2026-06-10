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
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Collections')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get()
  @ApiOperation({ summary: 'List active collections (paginated); filter by featured' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'featured', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Paginated collection list' })
  async findAll(@Query() query: any) {
    return this.collectionsService.findAll(query);
  }

  @Get('featured')
  @ApiOperation({ summary: 'Get top 6 featured active collections' })
  @ApiResponse({ status: 200, description: 'Featured collections' })
  async findFeatured() {
    return this.collectionsService.findFeatured();
  }

  @Get(':idOrSlug')
  @ApiOperation({ summary: 'Get a single collection by ID or slug, with paginated products' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Collection details with products' })
  async findOne(@Param('idOrSlug') idOrSlug: string, @Query() query: any) {
    return this.collectionsService.findOneByIdOrSlug(idOrSlug, query);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create a collection (admin only)' })
  @ApiResponse({ status: 201, description: 'Collection created' })
  async create(@Body() dto: CreateCollectionDto) {
    return this.collectionsService.create(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update a collection (admin only)' })
  @ApiResponse({ status: 200, description: 'Collection updated' })
  async update(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.collectionsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a collection (admin only)' })
  @ApiResponse({ status: 200, description: 'Collection deleted' })
  async remove(@Param('id') id: string) {
    return this.collectionsService.remove(id);
  }
}
