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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ReviewsService } from './reviews.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all reviews' })
  @ApiResponse({ status: 200, description: 'List of reviews' })
  async findAll(@Query('productId') productId?: string) {
    return this.reviewsService.findAll(productId);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get reviews written by the current user' })
  async getMyReviews(
    @Request() req: AuthedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviewsService.findByUser(
      req.user.id,
      parseInt(page || '', 10) || 1,
      parseInt(limit || '', 10) || 20,
    );
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get reviews by product ID' })
  @ApiResponse({ status: 200, description: 'List of reviews for product' })
  async findByProduct(@Param('productId') productId: string) {
    return this.reviewsService.findAll(productId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create review' })
  @ApiResponse({ status: 201, description: 'Review created' })
  async create(@Request() req: AuthedRequest, @Body() body: { productId: string; rating: number; comment: string }) {
    return this.reviewsService.create(req.user.id, body.productId, body);
  }

  @Post('product/:productId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create review for product' })
  @ApiResponse({ status: 201, description: 'Review created' })
  async createForProduct(
    @Param('productId') productId: string,
    @Request() req: AuthedRequest,
    @Body() body: { rating: number; comment: string; images?: string[] }
  ) {
    return this.reviewsService.create(req.user.id, productId, body);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update review' })
  @ApiResponse({ status: 200, description: 'Review updated' })
  async update(@Param('id') id: string, @Request() req: AuthedRequest, @Body() updateData: any) {
    return this.reviewsService.update(id, req.user.id, updateData);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete review' })
  @ApiResponse({ status: 200, description: 'Review deleted' })
  async remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.reviewsService.remove(id, req.user.id);
  }

  @Post(':id/helpful')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark review as helpful' })
  @ApiResponse({ status: 200, description: 'Review marked as helpful' })
  async markHelpful(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.reviewsService.markHelpful(id, req.user.id);
  }

  // -------- Admin endpoints --------

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Admin: list all reviews with filters and pagination' })
  async adminListReviews(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('productId') productId?: string,
  ) {
    return this.reviewsService.adminFindAll(
      parseInt(page || '', 10) || 1,
      parseInt(limit || '', 10) || 20,
      status,
      productId,
    );
  }

  @Put('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Admin: approve or reject a review' })
  async adminUpdateStatus(
    @Param('id') id: string,
    @Body() body: { status: 'approved' | 'rejected' },
  ) {
    return this.reviewsService.adminUpdateStatus(id, body.status);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Admin: delete any review' })
  async adminDelete(@Param('id') id: string) {
    return this.reviewsService.adminDelete(id);
  }
}

