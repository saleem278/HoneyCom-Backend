import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { EmailService } from '../../services/email.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Public endpoint — returns only the categories the storefront needs
   * (branding, storefront, seo). No auth required. Used by the frontend
   * SiteSettings context to drive brand name, announcement bar, meta tags, etc.
   */
  @Get('public')
  @Public()
  @ApiOperation({ summary: 'Get public storefront settings (no auth)' })
  async getPublic() {
    const [branding, storefront, seo, orders, navigation, footer, support, about, products, notifications, platform, payment] = await Promise.all([
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
      this.settingsService.getByCategory('payment'),
    ]);

    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const storefrontSettings = storefront.settings ?? {};
    if (!storefrontSettings['storefront.dealsEndsAt']) {
      storefrontSettings['storefront.dealsEndsAt'] = nextMidnight.toISOString();
    }

    // Only expose the non-secret payment setting (codEnabled). Never return
    // stripe/paypal credential keys in the public endpoint.
    const paymentPublic: Record<string, any> = {};
    const codEnabledRaw = (payment.settings ?? {})['payment.codEnabled'];
    paymentPublic['payment.codEnabled'] =
      codEnabledRaw === undefined || codEnabledRaw === null
        ? true
        : codEnabledRaw === true || codEnabledRaw === 'true' || codEnabledRaw === 'yes' || codEnabledRaw === 1;

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
        payment:       paymentPublic,
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
  async set(
    @Body() body: { key: string; value: any; category: string; description?: string },
    @Request() req: AuthedRequest,
  ) {
    return this.settingsService.set(body.key, body.value, body.category, body.description, req.user?.id);
  }

  @Put('bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Set multiple settings at once' })
  async setMultiple(
    @Body() body: { settings: Array<{ key: string; value: any; category: string; description?: string }> },
    @Request() req: AuthedRequest,
  ) {
    return this.settingsService.setMultiple(body.settings, req.user?.id);
  }

  /**
   * Send a test email to the requesting admin's address.
   * Verifies that the live SMTP transport is correctly configured.
   */
  @Post('email/test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Send a test email to the admin (SMTP verification)' })
  async sendTestEmail(@Request() req: AuthedRequest) {
    const to = req.user?.email;
    if (!to) throw new BadRequestException('Admin account has no email address on record');
    await this.emailService.sendEmail({
      to,
      subject: 'HoneyCom — SMTP test email',
      html: `<p>This is a test email sent from the <strong>HoneyCom admin panel</strong>.</p>
             <p>If you received this, your SMTP configuration is working correctly.</p>
             <p style="color:#6b7280;font-size:12px;">Sent at ${new Date().toISOString()}</p>`,
      text: `HoneyCom SMTP test email — sent at ${new Date().toISOString()}. If you received this, your SMTP configuration is working correctly.`,
    });
    return { success: true, message: `Test email sent to ${to}` };
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
