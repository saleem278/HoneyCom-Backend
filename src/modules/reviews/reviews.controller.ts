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
  async create(@Request() req, @Body() body: { productId: string; rating: number; comment: string }) {
    return this.reviewsService.create(req.user.id, body.productId, body);
  }

  @Post('product/:productId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create review for product' })
  @ApiResponse({ status: 201, description: 'Review created' })
  async createForProduct(
    @Param('productId') productId: string,
    @Request() req,
    @Body() body: { rating: number; comment: string; images?: string[] }
  ) {
    return this.reviewsService.create(req.user.id, productId, body);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update review' })
  @ApiResponse({ status: 200, description: 'Review updated' })
  async update(@Param('id') id: string, @Request() req, @Body() updateData: any) {
    return this.reviewsService.update(id, req.user.id, updateData);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete review' })
  @ApiResponse({ status: 200, description: 'Review deleted' })
  async remove(@Param('id') id: string, @Request() req) {
    return this.reviewsService.remove(id, req.user.id);
  }

  @Post(':id/helpful')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mark review as helpful' })
  @ApiResponse({ status: 200, description: 'Review marked as helpful' })
  async markHelpful(@Param('id') id: string, @Request() req) {
    return this.reviewsService.markHelpful(id, req.user.id);
  }
}

