import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DisputesService } from './disputes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Disputes')
@Controller('disputes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  @Roles('customer')
  @ApiOperation({ summary: 'Create a new dispute' })
  @ApiResponse({ status: 201, description: 'Dispute created' })
  async create(@Request() req, @Body() disputeData: any) {
    return this.disputesService.create(req.user.id, disputeData);
  }

  @Get()
  @ApiOperation({ summary: 'Get all disputes (filtered by user role)' })
  @ApiResponse({ status: 200, description: 'List of disputes' })
  async findAll(@Request() req, @Query() filters: any) {
    return this.disputesService.findAll(req.user.id, req.user.role, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dispute by ID' })
  @ApiResponse({ status: 200, description: 'Dispute details' })
  async findOne(@Param('id') id: string, @Request() req) {
    return this.disputesService.findOne(id, req.user.id, req.user.role);
  }

  @Put(':id/resolve')
  @Roles('admin')
  @ApiOperation({ summary: 'Resolve a dispute (admin only)' })
  @ApiResponse({ status: 200, description: 'Dispute resolved' })
  async resolve(@Param('id') id: string, @Request() req, @Body() resolutionData: any) {
    return this.disputesService.resolve(id, req.user.id, resolutionData);
  }

  @Put(':id/status')
  @Roles('admin')
  @ApiOperation({ summary: 'Update dispute status (admin only)' })
  @ApiResponse({ status: 200, description: 'Dispute status updated' })
  async updateStatus(@Param('id') id: string, @Request() req, @Body() body: { status: string }) {
    return this.disputesService.updateStatus(id, req.user.id, req.user.role, body.status);
  }

  @Put(':id/close')
  @ApiOperation({ summary: 'Close a resolved dispute' })
  @ApiResponse({ status: 200, description: 'Dispute closed' })
  async close(@Param('id') id: string, @Request() req) {
    return this.disputesService.close(id, req.user.id, req.user.role);
  }
}

