import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ThemesService } from './themes.service';
import { CreateThemeDto } from './dto/create-theme.dto';
import { UpdateThemeDto } from './dto/update-theme.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Themes')
@Controller('themes')
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  /** Public — all active themes list (for user picker) */
  @Get('public')
  @Public()
  @ApiOperation({ summary: 'Get all active themes (public)' })
  async getPublic() {
    const result = await this.themesService.findAll();
    return { ...result, themes: result.themes.filter((t: any) => t.isActive) };
  }

  /** User — get my effective theme */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user effective theme' })
  async getMyTheme(@Request() req: AuthedRequest) {
    return this.themesService.getMyTheme(req.user.id);
  }

  /** User — set my chosen theme */
  @Put('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Set current user theme preference' })
  async setMyTheme(
    @Request() req: AuthedRequest,
    @Body() body: { themeId: string | null; prefersDark?: boolean },
  ) {
    return this.themesService.setMyTheme(req.user.id, body.themeId, body.prefersDark);
  }

  /** Admin — list all themes */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List all themes (admin)' })
  async findAll() {
    return this.themesService.findAll();
  }

  /** Admin — create theme */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create theme (admin)' })
  async create(@Body() dto: CreateThemeDto, @Request() req: AuthedRequest) {
    return this.themesService.create(dto, req.user?.id);
  }

  /** Admin — get single theme */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get theme by id (admin)' })
  async findOne(@Param('id') id: string) {
    return this.themesService.findOne(id);
  }

  /** Admin — update theme */
  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update theme (admin)' })
  async update(@Param('id') id: string, @Body() dto: UpdateThemeDto) {
    return this.themesService.update(id, dto);
  }

  /** Admin — delete theme */
  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete theme (admin)' })
  async remove(@Param('id') id: string) {
    return this.themesService.remove(id);
  }

  /** Admin — set per-user theme preference */
  @Put('user/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'superadmin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Set theme preference for a specific user (admin)' })
  async setUserPref(
    @Param('userId') userId: string,
    @Body() body: { canChangeTheme?: 'inherit' | boolean; assignedThemeId?: string | null },
  ) {
    return this.themesService.setUserThemePref(userId, body);
  }
}
