import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
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
} from '@nestjs/swagger';
import { SearchService } from './search.service';
import { TrackSearchDto } from './dto/track-search.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post('track')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Track a search term (optional auth; rate-limited per user/term)' })
  @ApiResponse({ status: 200, description: 'Term tracked (or skipped as duplicate)' })
  async trackSearch(@Body() dto: TrackSearchDto, @Request() req: any) {
    const userId: string | undefined = req?.user?.id;
    return this.searchService.trackSearch(dto, userId);
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "Get authenticated user's last 10 unique search terms" })
  @ApiResponse({ status: 200, description: 'Search history' })
  async getUserHistory(@Request() req: AuthedRequest) {
    return this.searchService.getUserHistory(req.user.id);
  }

  @Delete('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Clear authenticated user's search history" })
  @ApiResponse({ status: 200, description: 'History cleared' })
  async clearUserHistory(@Request() req: AuthedRequest) {
    return this.searchService.clearUserHistory(req.user.id);
  }

  @Get('trending')
  @ApiOperation({ summary: 'Get top 10 trending search terms in the last 24 hours' })
  @ApiResponse({ status: 200, description: 'Trending terms' })
  async getTrending() {
    return this.searchService.getTrending();
  }
}
