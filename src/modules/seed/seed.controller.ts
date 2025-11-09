import { Controller, Post, Get, UseGuards, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SeedService } from './seed.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Seed')
@Controller('seed')
export class SeedController {
  constructor(private readonly seedService: SeedService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Seed database with sample data (Admin only)' })
  @ApiResponse({ status: 200, description: 'Database seeded successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only' })
  async seed() {
    return this.seedService.seed();
  }

  @Get('run')
  @ApiOperation({ summary: 'Seed database with sample data (Protected by parameter)' })
  @ApiQuery({ name: 'param', required: true, description: 'Secret parameter to authorize seeding', type: String })
  @ApiResponse({ status: 200, description: 'Database seeded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid parameter' })
  async seedWithParam(@Query('param') param: string) {
    if (param !== 'Mahi1407') {
      throw new BadRequestException('Invalid parameter. Access denied.');
    }
    return this.seedService.seed();
  }
}

