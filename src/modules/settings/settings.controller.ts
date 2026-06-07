import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Public endpoint — returns only the categories the storefront needs
   * (branding, storefront, seo). No auth required. Used by the frontend
   * SiteSettings context to drive brand name, announcement bar, meta tags, etc.
   */
  @Get('public')
  @Public()
  @ApiOperation({ summary: 'Get public storefront settings (no auth)' })
  async getPublic() {
    const [branding, storefront, seo, orders, navigation, footer, support, about, products, notifications, platform] = await Promise.all([
      this.settingsService.getByCategory('branding'),
      this.settingsService.getByCategory('storefront'),
      this.settingsService.getByCategory('seo'),
      this.settingsService.getByCategory('orders'),
      this.settingsService.getByCategory('navigation'),
      this.settingsService.getByCategory('footer'),
      this.settingsService.getByCategory('support'),
      this.settingsService.getByCategory('about'),
      this.settingsService.getByCategory('products'),
      this.settingsService.getByCategory('notifications'),
      this.settingsService.getByCategory('platform'),
    ]);

    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const storefrontSettings = storefront.settings ?? {};
    if (!storefrontSettings['storefront.dealsEndsAt']) {
      storefrontSettings['storefront.dealsEndsAt'] = nextMidnight.toISOString();
    }

    return {
      success: true,
      settings: {
        branding:      branding.settings,
        storefront:    storefrontSettings,
        seo:           seo.settings,
        orders:        orders.settings,
        navigation:    navigation.settings,
        footer:        footer.settings,
        support:       support.settings,
        about:         about.settings,
        products:      products.settings,
        notifications: notifications.settings,
        platform:      platform.settings,
      },
    };
  }

  // ── Admin-only routes ─────────────────────────────────────────────────────

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all settings (admin)' })
  async getAll(@Query('category') category?: string) {
    if (category) return this.settingsService.getByCategory(category);
    return this.settingsService.getAll();
  }

  @Get(':key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get setting by key' })
  async getByKey(@Param('key') key: string) {
    // Guard: don't let :key match 'public' and fall through to the wrong handler
    if (key === 'public') return this.getPublic();
    return this.settingsService.getByKey(key);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Set a setting' })
  async set(@Body() body: { key: string; value: any; category: string; description?: string }) {
    return this.settingsService.set(body.key, body.value, body.category, body.description);
  }

  @Put('bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Set multiple settings at once' })
  async setMultiple(@Body() body: { settings: Array<{ key: string; value: any; category: string; description?: string }> }) {
    return this.settingsService.setMultiple(body.settings);
  }

  @Delete(':key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete a setting' })
  async delete(@Param('key') key: string) {
    return this.settingsService.delete(key);
  }
}
