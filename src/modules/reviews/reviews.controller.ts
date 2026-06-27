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
import { Throttle } from '@nestjs/throttler';
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
import { AdminUpdateReviewStatusDto } from './dto/admin-update-status.dto';
import { AdminReplyDto } from './dto/admin-reply.dto';
import { ReportReviewDto } from './dto/report-review.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { CreateReviewDto, CreateProductReviewDto } from './dto/create-review.dto';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get all reviews' })
  @ApiResponse({ status: 200, description: 'List of reviews' })
  async findAll(@Query('productId') productId?: string) {
    return this.reviewsService.findAll(productId);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
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
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Get reviews by product ID' })
  @ApiResponse({ status: 200, description: 'List of reviews for product' })
  async findByProduct(@Param('productId') productId: string) {
    return this.reviewsService.findAll(productId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Create review' })
  @ApiResponse({ status: 201, description: 'Review created' })
  async create(@Request() req: AuthedRequest, @Body() body: CreateReviewDto) {
    return this.reviewsService.create(req.user.id, body.productId, body);
  }

  @Post('product/:productId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Create review for product' })
  @ApiResponse({ status: 201, description: 'Review created' })
  async createForProduct(
    @Param('productId') productId: string,
    @Request() req: AuthedRequest,
    @Body() body: CreateProductReviewDto,
  ) {
    return this.reviewsService.create(req.user.id, productId, body);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Update review' })
  @ApiResponse({ status: 200, description: 'Review updated' })
  async update(@Param('id') id: string, @Request() req: AuthedRequest, @Body() updateData: any) {
    return this.reviewsService.update(id, req.user.id, updateData);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Delete review' })
  @ApiResponse({ status: 200, description: 'Review deleted' })
  async remove(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.reviewsService.remove(id, req.user.id);
  }

  @Post(':id/helpful')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Mark review as helpful' })
  @ApiResponse({ status: 200, description: 'Review marked as helpful' })
  async markHelpful(@Param('id') id: string, @Request() req: AuthedRequest) {
    return this.reviewsService.markHelpful(id, req.user.id);
  }

  // -------- Customer: report a review --------

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Report a review as abusive' })
  @ApiResponse({ status: 200, description: 'Review reported' })
  async reportReview(
    @Param('id') id: string,
    @Request() req: AuthedRequest,
    @Body() body: ReportReviewDto,
  ) {
    return this.reviewsService.reportReview(id, req.user.id, body.reason);
  }

  // -------- Admin endpoints --------

  @Get('admin/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: review KPI stats (pending count, approval rate, avg rating, 1-star count)' })
  async adminGetStats() {
    return this.reviewsService.adminGetStats();
  }

  @Get('admin/all')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: list all reviews with filters, search and pagination' })
  async adminListReviews(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('productId') productId?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
    @Query('rating') rating?: string,
    @Query('verifiedPurchase') verifiedPurchase?: string,
    @Query('reported') reported?: string,
    @Query('sort') sort?: string,
  ) {
    return this.reviewsService.adminFindAll(
      parseInt(page || '', 10) || 1,
      parseInt(limit || '', 10) || 20,
      status,
      productId,
      userId,
      search,
      rating ? parseInt(rating, 10) : undefined,
      verifiedPurchase === 'true' ? true : undefined,
      reported === 'true' ? true : undefined,
      sort,
    );
  }

  @Put('admin/bulk/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: bulk approve or reject reviews' })
  async adminBulkUpdateStatus(
    @Body() body: BulkStatusDto,
    @Request() req: AuthedRequest,
  ) {
    return this.reviewsService.adminBulkUpdateStatus(
      body.ids,
      body.status,
      body.rejectionReason,
      req.user.id,
    );
  }

  @Delete('admin/bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: bulk delete reviews' })
  async adminBulkDelete(@Body() body: BulkDeleteDto) {
    return this.reviewsService.adminBulkDelete(body.ids);
  }

  @Put('admin/:id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: approve or reject a review (with optional rejection reason)' })
  async adminUpdateStatus(
    @Param('id') id: string,
    @Body() body: AdminUpdateReviewStatusDto,
    @Request() req: AuthedRequest,
  ) {
    return this.reviewsService.adminUpdateStatus(id, body, req.user.id);
  }

  @Put('admin/:id/reply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: add or update a public reply to a review' })
  async adminSetReply(
    @Param('id') id: string,
    @Body() body: AdminReplyDto,
  ) {
    return this.reviewsService.adminSetReply(id, body);
  }

  @Delete('admin/:id/reply')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: delete the reply on a review' })
  async adminDeleteReply(@Param('id') id: string) {
    return this.reviewsService.adminDeleteReply(id);
  }

  @Delete('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Admin: delete any review' })
  async adminDelete(@Param('id') id: string) {
    return this.reviewsService.adminDelete(id);
  }
}

