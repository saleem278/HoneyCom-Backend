import { Controller, Post, Get, UseGuards, Query, BadRequestException, ForbiddenException } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Seed database with sample data (Admin only, non-production)' })
  @ApiResponse({ status: 200, description: 'Database seeded successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin only or production environment' })
  async seed() {
    // Hard-block in production. A seed wipes the entire database; allowing
    // it on a live environment is catastrophic even if accidentally called.
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException(
        'Database seeding is disabled in production. Use a restore from backup instead.',
      );
    }
    return this.seedService.seed();
  }

  // GET /seed/run was a backdoor protected by a hardcoded query-param secret.
  // It has been intentionally removed. Use POST /seed (admin JWT required) instead.
  // If you need to seed from a terminal without an admin token, use the npm run seed CLI command.
}

