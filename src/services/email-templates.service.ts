import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ISettings } from '../models/Settings.model';

/**
 * Email templates service.
 *
 * Brand name, tagline, primary colour, support email and logo emoji are all
 * read from the `settings` collection so the admin can change them without
 * a redeploy. A lightweight in-memory cache (5-minute TTL) prevents a DB
 * round-trip on every single email.
 *
 * ── Design system ──────────────────────────────────────────────────────────
 * Templates mirror the Next.js storefront design system (see the frontend
 * `globals.css`): Inter font stack, white surface cards on a muted grey page,
 * a clean light header with the logo emoji in a rounded gradient chip, and a
 * dark navy footer. Every email is composed from the shared component helpers
 * (`button`, `infoBox`, `iconBadge`, `heading`, `paragraph`, `pill`,
 * `linkFallback`) and wrapped by `getBaseTemplate` so the whole flow stays
 * visually consistent.
 */
@Injectable()
export class EmailTemplatesService {
  constructor(
    private configService: ConfigService,
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
  ) {}

  // ── Design tokens (mirrors frontend globals.css) ───────────────────────────
  private static readonly T = {
    // surfaces & text
    page: '#f9fafb', // --surface-muted (page background)
    surface: '#ffffff', // --surface (card)
    fg: '#111827', // --fg (body text)
    fgStrong: '#374151', // --fg-strong (headings/labels)
    fgMuted: '#4b5563', // --fg-muted (secondary text)
    fgSubtle: '#9ca3af', // --fg-subtle (hints)
    line: '#e5e7eb', // --line (borders)
    // brand footer (matches site footer / announcement bar)
    footer: '#1a1a2e', // --brand-dark
    footerText: '#cbd5e1',
    footerSubtle: '#94a3b8',
    // status accents
    success: '#16a34a',
    successBg: '#ecfdf5',
    successFg: '#065f46',
    error: '#ef4444',
    errorBg: '#fef2f2',
    errorFg: '#991b1b',
    warning: '#f59e0b',
    warningBg: '#fffbeb',
    warningFg: '#78350f',
    info: '#0ea5e9',
    infoBg: '#f0f9ff',
    infoFg: '#075985',
    // radii
    radiusCard: '20px', // --radius-xl
    radiusBtn: '12px', // --radius-md
    radiusBox: '12px',
    // typography
    font: "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI','Roboto','Helvetica Neue',Arial,sans-serif",
  };

  // ── Branding cache ─────────────────────────────────────────────────────────
  private brandCache: Record<string, string> | null = null;
  private brandCacheAt = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private async brand(): Promise<Record<string, string>> {
    const now = Date.now();
    if (this.brandCache && now - this.brandCacheAt < EmailTemplatesService.CACHE_TTL_MS) {
      return this.brandCache;
    }
    const rows = await this.settingsModel.find({ category: 'branding' }).lean();
    const map: Record<string, string> = {};
    for (const r of rows) {
      // key is e.g. "branding.siteName" — strip prefix for convenience
      const k = r.key.replace(/^branding\./, '');
      map[k] = String(r.value ?? '');
    }
    this.brandCache = map;
    this.brandCacheAt = now;
    return map;
  }

  /** Invalidate cache so next email picks up fresh settings immediately. */
  invalidateCache() {
    this.brandCache = null;
    this.brandCacheAt = 0;
    this.emailCache = null;
    this.emailCacheAt = 0;
  }

  // ── Email template settings cache ─────────────────────────────────────────
  private emailCache: Record<string, string> | null = null;
  private emailCacheAt = 0;

  private async emailSettings(): Promise<Record<string, string>> {
    const now = Date.now();
    if (this.emailCache && now - this.emailCacheAt < EmailTemplatesService.CACHE_TTL_MS) {
      return this.emailCache;
    }
    const rows = await this.settingsModel.find({ category: 'email' }).lean();
    const map: Record<string, string> = {};
    for (const r of rows) {
      const k = r.key.replace(/^email\./, '');
      map[k] = String(r.value ?? '');
    }
    this.emailCache = map;
    this.emailCacheAt = now;
    return map;
  }

  // ── HTML escaping ──────────────────────────────────────────────────────────
  private h(str: unknown): string {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  private frontend(): string {
    return this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }

  /** Resolve admin-configurable brand colours, falling back to the design-system defaults. */
  private async colors(): Promise<{ primary: string; primaryAlt: string }> {
    const b = await this.brand();
    return {
      primary: b.primaryColor || '#f97316', // --accent-500
      primaryAlt: b.primaryColorAlt || '#fb923c', // --accent-grad-500
    };
  }

  // ── Reusable component helpers (the shared "routine" every email uses) ──────

  /** Circular gradient icon chip, echoing the storefront logo chip. */
  private iconBadge(emoji: string, primary: string, primaryAlt: string): string {
    return `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 20px;">
        <tr><td align="center" valign="middle" width="72" height="72"
          style="width:72px;height:72px;border-radius:18px;background:linear-gradient(135deg,${primary} 0%,${primaryAlt} 100%);text-align:center;font-size:34px;line-height:72px;mso-line-height-rule:exactly;">
          ${emoji}
        </td></tr>
      </table>`;
  }

  /** H2 heading in the design-system style (Inter, -0.025em tracking). */
  private heading(text: string): string {
    const T = EmailTemplatesService.T;
    return `<h2 style="margin:0 0 8px;color:${T.fg};font-size:26px;font-weight:800;letter-spacing:-0.025em;line-height:1.15;">${text}</h2>`;
  }

  /** Muted secondary paragraph. */
  private paragraph(text: string, opts: { center?: boolean; size?: number } = {}): string {
    const T = EmailTemplatesService.T;
    const align = opts.center ? 'text-align:center;' : '';
    const size = opts.size || 16;
    return `<p style="margin:0;color:${T.fgMuted};font-size:${size}px;line-height:1.6;${align}">${text}</p>`;
  }

  /** Primary gradient CTA button (matches the storefront primary button). */
  private button(url: string, label: string, primary: string, primaryAlt: string): string {
    const T = EmailTemplatesService.T;
    return `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;">
        <tr><td align="center" style="border-radius:${T.radiusBtn};background:linear-gradient(135deg,${primary} 0%,${primaryAlt} 100%);">
          <a href="${url}" target="_blank" style="display:inline-block;padding:15px 34px;color:#ffffff;text-decoration:none;border-radius:${T.radiusBtn};font-family:${T.font};font-weight:700;font-size:16px;letter-spacing:-0.01em;">${label}</a>
        </td></tr>
      </table>`;
  }

  /** Coloured, left-accented information box. variant ∈ accent|success|warning|error|info */
  private infoBox(
    body: string,
    variant: 'accent' | 'success' | 'warning' | 'error' | 'info',
    primary?: string,
  ): string {
    const T = EmailTemplatesService.T;
    const map = {
      accent: { bar: primary || '#f97316', bg: '#fff7ed', fg: '#9a3412' },
      success: { bar: T.success, bg: T.successBg, fg: T.successFg },
      warning: { bar: T.warning, bg: T.warningBg, fg: T.warningFg },
      error: { bar: T.error, bg: T.errorBg, fg: T.errorFg },
      info: { bar: T.info, bg: T.infoBg, fg: T.infoFg },
    }[variant];
    return `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 24px;border-radius:${T.radiusBox};background-color:${map.bg};border-left:4px solid ${map.bar};">
        <tr><td style="padding:18px 20px;color:${map.fg};font-size:14px;line-height:1.65;">${body}</td></tr>
      </table>`;
  }

  /** Small rounded pill / badge. */
  private pill(text: string, primary: string): string {
    return `<span style="display:inline-block;padding:5px 14px;background-color:#fff7ed;color:${primary};border-radius:9999px;font-size:13px;font-weight:700;letter-spacing:-0.01em;">${text}</span>`;
  }

  /** "Trouble clicking?" raw-link fallback block. */
  private linkFallback(url: string, primary: string): string {
    const T = EmailTemplatesService.T;
    return `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:28px 0 0;border-top:1px solid ${T.line};">
        <tr><td style="padding-top:24px;">
          <p style="margin:0 0 8px;color:${T.fgMuted};font-size:13px;line-height:1.6;"><strong>Having trouble with the button?</strong> Copy and paste this link into your browser:</p>
          <p style="margin:0;word-break:break-all;"><a href="${url}" target="_blank" style="color:${primary};text-decoration:underline;font-size:13px;">${url}</a></p>
        </td></tr>
      </table>`;
  }

  // ── Base template ─────────────────────────────────────────────────────────
  private async getBaseTemplate(content: string, title: string, preheader = ''): Promise<string> {
    const T = EmailTemplatesService.T;
    const b = await this.brand();
    const { primary, primaryAlt } = await this.colors();
    const frontendUrl = this.frontend();
    const siteName = this.h(b.siteName || 'Our Store');
    const tagline = this.h(b.tagline || '');
    const logoEmoji = this.h(b.logoEmoji || '🛒');
    const supportEmail = this.h(b.supportEmail || '');
    const year = new Date().getFullYear();

    return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${this.h(title)} - ${siteName}</title>
  <!--[if mso]><style>body,table,td,a{font-family:Arial,Helvetica,sans-serif !important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${T.page};font-family:${T.font};-webkit-font-smoothing:antialiased;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${this.h(preheader)}</div>` : ''}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:${T.page};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${T.surface};border:1px solid ${T.line};border-radius:${T.radiusCard};overflow:hidden;">

          <!-- Header: light surface with gradient logo chip + brand name -->
          <tr>
            <td style="padding:28px 32px;border-bottom:1px solid ${T.line};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="middle" width="44" height="44" align="center"
                    style="width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,${primary} 0%,${primaryAlt} 100%);text-align:center;font-size:22px;line-height:44px;mso-line-height-rule:exactly;">${logoEmoji}</td>
                  <td valign="middle" style="padding-left:12px;">
                    <span style="font-size:20px;font-weight:800;letter-spacing:-0.02em;color:${primary};">${siteName}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:36px 32px;">
              ${content}
            </td>
          </tr>

          <!-- Footer: dark navy, matching the storefront footer -->
          <tr>
            <td style="padding:28px 32px;background-color:${T.footer};">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align:center;padding-bottom:18px;">
                    <p style="margin:0;color:#ffffff;font-size:16px;font-weight:800;letter-spacing:-0.02em;">${siteName}</p>
                    ${tagline ? `<p style="margin:6px 0 0;color:${T.footerSubtle};font-size:13px;">${tagline}</p>` : ''}
                  </td>
                </tr>
                <tr>
                  <td style="text-align:center;padding-bottom:18px;">
                    <a href="${frontendUrl}" target="_blank" style="display:inline-block;padding:11px 24px;border:1px solid rgba(255,255,255,0.25);color:#ffffff;text-decoration:none;border-radius:${T.radiusBtn};font-weight:600;font-size:14px;">Visit our store</a>
                  </td>
                </tr>
                <tr>
                  <td style="text-align:center;border-top:1px solid rgba(255,255,255,0.1);padding-top:18px;">
                    <p style="margin:0;color:${T.footerSubtle};font-size:12px;line-height:1.6;">
                      ${supportEmail ? `Questions? Contact us at <a href="mailto:${supportEmail}" style="color:${T.footerText};text-decoration:underline;">${supportEmail}</a><br>` : 'Questions? Just reply to this email and our support team will help.<br>'}
                      &copy; ${year} ${siteName}. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
  }

  /** Compose a centred header block: icon badge + heading + optional subtext. */
  private async hero(emoji: string, title: string, subtitle?: string): Promise<string> {
    const { primary, primaryAlt } = await this.colors();
    return `
      <div style="text-align:center;margin-bottom:28px;">
        ${this.iconBadge(emoji, primary, primaryAlt)}
        ${this.heading(title)}
        ${subtitle ? this.paragraph(subtitle, { center: true }) : ''}
      </div>`;
  }

  // ── Public template methods (all async) ────────────────────────────────────

  /** Expose email setting to email.service.ts for subject line overrides. */
  async getEmailSetting(key: string, fallback: string): Promise<string> {
    const et = await this.emailSettings();
    return et[key] || fallback;
  }

  async getSiteName(): Promise<string> {
    const b = await this.brand();
    return b.siteName || 'Our Store';
  }

  async getVerificationEmail(token: string): Promise<string> {
    const verificationUrl = `${this.frontend()}/verify-email?token=${token}`;
    const siteName = this.h(await this.getSiteName());
    const { primary, primaryAlt } = await this.colors();
    const et = await this.emailSettings();
    const ctaText = this.h(et.verifyCta || 'Verify email address');
    const intro = this.h(et.verifyIntro || `Welcome to ${siteName}! Please verify your email to start shopping.`);

    const content = `
      ${await this.hero('✉️', `Welcome to ${siteName}!`, intro)}
      ${this.infoBox('<strong>Almost there!</strong> Please verify your email address to complete your registration and start shopping.', 'warning')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(verificationUrl, ctaText, primary, primaryAlt)}
      </div>
      ${this.linkFallback(verificationUrl, primary)}
      ${this.infoBox('⏰ <strong>This link expires in 24 hours.</strong> If you didn&apos;t create an account, you can safely ignore this email.', 'warning')}`;

    return this.getBaseTemplate(content, 'Verify Your Email', `Verify your email to get started on ${siteName}.`);
  }

  async getPasswordResetEmail(token: string): Promise<string> {
    const resetUrl = `${this.frontend()}/reset-password?token=${token}`;
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('🔒', 'Reset your password', 'We received a request to reset your password.')}
      ${this.infoBox('Click the button below to choose a new password. If you didn&apos;t request this, you can safely ignore this email — your password won&apos;t change.', 'warning')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(resetUrl, 'Reset password', primary, primaryAlt)}
      </div>
      ${this.linkFallback(resetUrl, primary)}
      ${this.infoBox('⏰ <strong>This link expires in 1 hour.</strong> For your security, please don&apos;t share it with anyone.', 'warning')}`;

    return this.getBaseTemplate(content, 'Reset Your Password', 'Reset your password — link valid for 1 hour.');
  }

  async getOrderConfirmationEmail(order: any): Promise<string> {
    const T = EmailTemplatesService.T;
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const orderUrl = `${this.frontend()}/orders/${order._id || ''}`;
    const { primary, primaryAlt } = await this.colors();
    const currencySymbol = this.getCurrencySymbol(order.currency || 'INR');

    const itemsHtml = (order.items || []).map((item: any) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid ${T.line};">
          <p style="margin:0;color:${T.fg};font-weight:600;font-size:15px;">${this.h(item.name || 'Product')}</p>
          <p style="margin:4px 0 0;color:${T.fgMuted};font-size:13px;">Qty: ${this.h(item.quantity || 1)}</p>
        </td>
        <td style="padding:14px 0;text-align:right;border-bottom:1px solid ${T.line};vertical-align:top;">
          <p style="margin:0;color:${T.fg};font-weight:700;font-size:15px;">${currencySymbol}${(item.price || 0).toFixed(0)}</p>
        </td>
      </tr>`).join('');

    const summaryRow = (label: string, value: string, opts: { color?: string; bold?: boolean } = {}) => `
      <tr>
        <td style="padding:7px 0;color:${opts.color || T.fgMuted};font-size:14px;">${label}</td>
        <td style="padding:7px 0;text-align:right;color:${opts.color || T.fg};font-size:14px;font-weight:${opts.bold ? 700 : 600};">${value}</td>
      </tr>`;

    const content = `
      ${await this.hero('✅', 'Order confirmed!', 'Thank you for your order — we&apos;re on it.')}
      <div style="text-align:center;margin-bottom:26px;">${this.pill(`Order #${this.h(orderId)}`, primary)}</div>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:8px;">
        <thead>
          <tr>
            <th style="padding:0 0 10px;text-align:left;color:${T.fgStrong};font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid ${T.line};">Item</th>
            <th style="padding:0 0 10px;text-align:right;color:${T.fgStrong};font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid ${T.line};">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:24px 0;background-color:${T.page};border-radius:${T.radiusBox};">
        <tr><td style="padding:18px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            ${summaryRow('Subtotal', `${currencySymbol}${(order.subtotal || 0).toFixed(0)}`)}
            ${order.tax ? summaryRow('Tax', `${currencySymbol}${order.tax.toFixed(0)}`) : ''}
            ${order.shipping ? summaryRow('Shipping', `${currencySymbol}${order.shipping.toFixed(0)}`) : ''}
            ${order.discount ? summaryRow('Discount', `-${currencySymbol}${order.discount.toFixed(0)}`, { color: T.success }) : ''}
            <tr>
              <td style="padding:14px 0 0;border-top:2px solid ${T.line};color:${T.fg};font-size:18px;font-weight:800;">Total</td>
              <td style="padding:14px 0 0;border-top:2px solid ${T.line};text-align:right;color:${primary};font-size:20px;font-weight:800;">${currencySymbol}${(order.total || 0).toFixed(0)}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      <div style="text-align:center;margin:28px 0;">
        ${this.button(orderUrl, 'View order details', primary, primaryAlt)}
      </div>
      ${this.infoBox('<strong>📦 What&apos;s next?</strong> We&apos;ll email you again as soon as your order ships. You can track it anytime from your account.', 'success')}`;

    return this.getBaseTemplate(content, `Order Confirmation - #${orderId}`, `Your order #${orderId} is confirmed.`);
  }

  async getOrderStatusUpdateEmail(order: any): Promise<string> {
    const T = EmailTemplatesService.T;
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const orderUrl = `${this.frontend()}/orders/${order._id || ''}`;
    const { primary, primaryAlt } = await this.colors();
    const status = order.status || 'updated';
    const statusEmoji = this.getStatusEmoji(status);
    const variant = this.getStatusVariant(status);

    const content = `
      ${await this.hero(statusEmoji, 'Order status updated', `Order #${this.h(orderId)}`)}
      ${this.infoBox(
        `<span style="font-size:16px;font-weight:700;text-transform:capitalize;">${statusEmoji} ${this.h(status)}</span><br><span style="opacity:0.85;">Order #${this.h(orderId)}</span>`,
        variant,
        primary,
      )}
      ${order.trackingNumber ? this.infoBox(
        `<strong>📦 Tracking information</strong><br><strong>Tracking number:</strong> ${this.h(order.trackingNumber)}` +
        `${order.carrier ? `<br><strong>Carrier:</strong> ${this.h(order.carrier)}` : ''}`,
        'info',
      ) : ''}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(orderUrl, 'View order details', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, `Order Update - #${orderId}`, `Your order #${orderId} is now ${this.h(status)}.`);
  }

  async getSellerApprovalEmail(sellerName: string): Promise<string> {
    const frontendUrl = this.frontend();
    const siteName = this.h(await this.getSiteName());
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('🎉', `Congratulations, ${this.h(sellerName)}!`, 'Your seller account has been approved.')}
      ${this.infoBox(
        `<strong style="font-size:16px;">Welcome to ${siteName}!</strong><br>Your seller account is now active. Start listing your products and reach thousands of customers.`,
        'success',
      )}
      ${this.infoBox(
        `<strong>🚀 What you can do now:</strong>` +
        `<ul style="margin:10px 0 0;padding-left:20px;line-height:1.8;">` +
        `<li>Add and manage your products</li>` +
        `<li>Track your orders and sales</li>` +
        `<li>View detailed analytics and insights</li>` +
        `<li>Manage your store profile and settings</li>` +
        `</ul>`,
        'warning',
      )}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${frontendUrl}/seller`, 'Access seller dashboard', primary, primaryAlt)}
      </div>
      ${this.infoBox('💡 <strong>Need help?</strong> Our support team is here for you. If you have questions about selling, don&apos;t hesitate to reach out.', 'success')}`;

    return this.getBaseTemplate(content, 'Seller Account Approved', `Your ${siteName} seller account has been approved.`);
  }

  async getSellerRejectionEmail(sellerName: string, reason?: string): Promise<string> {
    const frontendUrl = this.frontend();
    const siteName = this.h(await this.getSiteName());
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('📋', 'Seller application status')}
      ${this.infoBox(
        `Dear ${this.h(sellerName)},<br><br>We regret to inform you that your seller account application has not been approved at this time.` +
        `${reason ? `<br><br><strong>Reason:</strong> ${this.h(reason)}` : ''}`,
        'error',
      )}
      ${this.infoBox('If you believe this is an error, or would like to reapply with additional information, please contact our support team.', 'warning')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${frontendUrl}/contact`, 'Contact support', primary, primaryAlt)}
      </div>
      <p style="margin:0;text-align:center;color:${EmailTemplatesService.T.fgSubtle};font-size:13px;line-height:1.6;">Thank you for your interest in selling on <strong style="color:${primary};">${siteName}</strong>. We appreciate your understanding.</p>`;

    return this.getBaseTemplate(content, 'Seller Account Application Status', `Update on your ${siteName} seller application.`);
  }

  async getProductApprovalEmail(productName: string): Promise<string> {
    const frontendUrl = this.frontend();
    const siteName = this.h(await this.getSiteName());
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('🎉', 'Your product is live!')}
      ${this.infoBox(
        `Great news! Your product <strong>${this.h(productName)}</strong> has been approved and is now live on ${siteName}. Customers can find and purchase it right away.`,
        'success',
      )}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${frontendUrl}/seller/products`, 'Manage your products', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'Product Approved', `Your product "${productName}" is now live.`);
  }

  async getProductRejectionEmail(productName: string, reason?: string): Promise<string> {
    const frontendUrl = this.frontend();
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('📋', 'Product not approved')}
      ${this.infoBox(
        `Your product <strong>${this.h(productName)}</strong> was not approved.` +
        `${reason ? `<br><br><strong>Reason:</strong> ${this.h(reason)}` : '<br><br>Please review the listing guidelines and update your product before resubmitting.'}`,
        'error',
      )}
      ${this.infoBox('Once you&apos;ve made the necessary changes, you can resubmit your product for review from your seller dashboard.', 'warning')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${frontendUrl}/seller/products`, 'Review your products', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'Product Not Approved', `Update on your product "${productName}".`);
  }

  async getProductQuestionEmail(opts: {
    sellerName: string;
    productName: string;
    productId: string;
    question: string;
    customerEmail?: string;
  }): Promise<string> {
    const frontendUrl = this.frontend();
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('💬', 'New customer question', `Hi ${this.h(opts.sellerName)}, a customer has a question.`)}
      ${this.paragraph(`A customer asked a question about your product <strong style="color:${EmailTemplatesService.T.fg};">${this.h(opts.productName)}</strong>:`)}
      ${this.infoBox(`<em>&ldquo;${this.h(opts.question)}&rdquo;</em>`, 'accent', primary)}
      ${opts.customerEmail ? this.paragraph(`<strong>Customer email:</strong> ${this.h(opts.customerEmail)}`, { size: 14 }) : ''}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${frontendUrl}/seller/products/${opts.productId}`, 'Answer this question', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'New Product Question', `New question on "${opts.productName}".`);
  }

  async getContactEmail(opts: {
    fromName: string;
    fromEmail: string;
    subject: string;
    message: string;
  }): Promise<string> {
    const T = EmailTemplatesService.T;
    const { primary } = await this.colors();

    const content = `
      ${await this.hero('📨', 'New contact message')}
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;background-color:${T.page};border-radius:${T.radiusBox};">
        <tr><td style="padding:18px 20px;">
          <p style="margin:0 0 6px;color:${T.fgMuted};font-size:14px;"><strong style="color:${T.fgStrong};">From:</strong> ${this.h(opts.fromName)} &lt;${this.h(opts.fromEmail)}&gt;</p>
          <p style="margin:0;color:${T.fgMuted};font-size:14px;"><strong style="color:${T.fgStrong};">Subject:</strong> ${this.h(opts.subject)}</p>
        </td></tr>
      </table>
      ${this.infoBox(`<span style="white-space:pre-wrap;color:${T.fg};">${this.h(opts.message)}</span>`, 'accent', primary)}`;

    return this.getBaseTemplate(content, `Contact: ${opts.subject}`, `New contact message from ${opts.fromName}.`);
  }

  async getNewSellerNotificationEmail(opts: {
    sellerName: string;
    sellerEmail: string;
    storeName?: string;
  }): Promise<string> {
    const frontendUrl = this.frontend();
    const T = EmailTemplatesService.T;
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('🛍️', 'New seller registration', 'A new seller is awaiting approval.')}
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:20px;background-color:${T.page};border-radius:${T.radiusBox};">
        <tr><td style="padding:18px 20px;">
          <p style="margin:0 0 6px;color:${T.fgMuted};font-size:14px;"><strong style="color:${T.fgStrong};">Name:</strong> ${this.h(opts.sellerName)}</p>
          <p style="margin:0 0 6px;color:${T.fgMuted};font-size:14px;"><strong style="color:${T.fgStrong};">Email:</strong> ${this.h(opts.sellerEmail)}</p>
          ${opts.storeName ? `<p style="margin:0;color:${T.fgMuted};font-size:14px;"><strong style="color:${T.fgStrong};">Store:</strong> ${this.h(opts.storeName)}</p>` : ''}
        </td></tr>
      </table>
      ${this.infoBox('Please review this application in the admin dashboard and approve or reject it.', 'warning')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${frontendUrl}/admin/sellers`, 'Review in admin dashboard', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'New Seller Registration', `New seller registration: ${opts.sellerName}.`);
  }

  async getWelcomeEmail(): Promise<string> {
    const frontendUrl = this.frontend();
    const siteName = this.h(await this.getSiteName());
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('🎉', `Welcome to ${siteName}!`, 'Your email is verified and your account is ready.')}
      ${this.infoBox('Thanks for joining us! Your account is all set. Explore thousands of products and enjoy a seamless shopping experience.', 'success')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${frontendUrl}/products`, 'Start shopping', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'Welcome', `Welcome to ${siteName} — your account is ready.`);
  }

  async getPasswordChangedEmail(context: 'reset' | 'changed' = 'changed'): Promise<string> {
    const frontendUrl = this.frontend();
    const { primary, primaryAlt } = await this.colors();
    const verb = context === 'reset' ? 'reset' : 'changed';

    const content = `
      ${await this.hero('🔐', `Your password was ${verb}`, 'This is a confirmation of a recent change to your account.')}
      ${this.infoBox(`Your account password was successfully ${verb}. For your security, you may have been signed out on your other devices.`, 'success')}
      ${this.infoBox(`🛡️ <strong>Didn&apos;t do this?</strong> If you did not ${verb} your password, your account may be at risk. Please reset your password immediately and contact our support team.`, 'error')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${frontendUrl}/forgot-password`, 'Secure my account', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'Password Changed', `Your password was ${verb}.`);
  }

  async getRefundProcessedEmail(order: any, amount?: number, reason?: string): Promise<string> {
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const orderUrl = `${this.frontend()}/orders/${order._id || ''}`;
    const { primary, primaryAlt } = await this.colors();
    const sym = this.getCurrencySymbol(order.currency || 'INR');
    const refundAmt = amount != null ? amount : order.total || 0;

    const content = `
      ${await this.hero('💰', 'Refund processed', 'Your refund is on its way.')}
      <div style="text-align:center;margin-bottom:24px;">${this.pill(`Order #${this.h(orderId)}`, primary)}</div>
      ${this.infoBox(
        `We&apos;ve processed a refund of <strong>${sym}${refundAmt.toFixed(0)}</strong> for your order.` +
        `${reason ? `<br><br><strong>Reason:</strong> ${this.h(reason)}` : ''}` +
        `<br><br>Depending on your bank or payment provider, it may take 5–10 business days to appear in your account.`,
        'success',
      )}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(orderUrl, 'View order details', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, `Refund Processed - #${orderId}`, `Your refund of ${sym}${refundAmt.toFixed(0)} has been processed.`);
  }

  async getPaymentFailedEmail(order: any): Promise<string> {
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const cartUrl = `${this.frontend()}/cart`;
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('⚠️', 'Payment failed', `We couldn&apos;t process the payment for order #${this.h(orderId)}.`)}
      ${this.infoBox('Unfortunately your payment didn&apos;t go through, so the order has been cancelled. No money has been taken from your account. You can try placing the order again at any time.', 'error')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(cartUrl, 'Try again', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, `Payment Failed - #${orderId}`, `Payment for order #${orderId} failed.`);
  }

  async getNewOrderSellerEmail(opts: { sellerName: string; order: any; items: any[] }): Promise<string> {
    const T = EmailTemplatesService.T;
    const { order, items, sellerName } = opts;
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const { primary, primaryAlt } = await this.colors();
    const sym = this.getCurrencySymbol(order.currency || 'INR');

    const itemsHtml = (items || []).map((item: any) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${T.line};color:${T.fg};font-size:14px;">${this.h(item.name || 'Product')} <span style="color:${T.fgMuted};">× ${this.h(item.quantity || 1)}</span></td>
        <td style="padding:12px 0;border-bottom:1px solid ${T.line};text-align:right;color:${T.fg};font-weight:700;font-size:14px;">${sym}${((item.price || 0) * (item.quantity || 1)).toFixed(0)}</td>
      </tr>`).join('');

    const content = `
      ${await this.hero('🛒', 'You have a new order!', `Hi ${this.h(sellerName)}, you&apos;ve received a new order.`)}
      <div style="text-align:center;margin-bottom:24px;">${this.pill(`Order #${this.h(orderId)}`, primary)}</div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom:8px;">${itemsHtml}</table>
      ${this.infoBox('Please review and fulfil this order from your seller dashboard. Update the status and add tracking details once you&apos;ve shipped it.', 'warning')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${this.frontend()}/seller/orders`, 'Manage order', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, `New Order - #${orderId}`, `New order #${orderId} received.`);
  }

  async getDisputeConfirmationEmail(dispute: any, order: any): Promise<string> {
    const orderId = order?.orderNumber || (order?._id ? order._id.toString().slice(-8) : 'N/A');
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('🧾', 'Dispute received', 'We&apos;ve received your dispute and our team will review it.')}
      <div style="text-align:center;margin-bottom:24px;">${this.pill(`Order #${this.h(orderId)}`, primary)}</div>
      ${this.infoBox(
        `<strong>Type:</strong> ${this.h(dispute.type || 'N/A')}<br><strong>Reason:</strong> ${this.h(dispute.reason || 'N/A')}` +
        `${dispute.description ? `<br><br>${this.h(dispute.description)}` : ''}`,
        'accent', primary,
      )}
      ${this.infoBox('Our support team typically responds within 2–3 business days. We&apos;ll email you as soon as there&apos;s an update.', 'info')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${this.frontend()}/orders/${order?._id || ''}`, 'View order', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'Dispute Received', `We received your dispute for order #${orderId}.`);
  }

  async getDisputeAlertEmail(opts: { dispute: any; order: any; portal: 'seller' | 'admin' }): Promise<string> {
    const { dispute, order, portal } = opts;
    const orderId = order?.orderNumber || (order?._id ? order._id.toString().slice(-8) : 'N/A');
    const { primary, primaryAlt } = await this.colors();
    const link = portal === 'admin' ? `${this.frontend()}/admin/disputes` : `${this.frontend()}/seller/disputes`;

    const content = `
      ${await this.hero('⚠️', 'New dispute raised', `A dispute has been opened on order #${this.h(orderId)}.`)}
      ${this.infoBox(
        `<strong>Type:</strong> ${this.h(dispute.type || 'N/A')}<br><strong>Reason:</strong> ${this.h(dispute.reason || 'N/A')}` +
        `${dispute.description ? `<br><br>${this.h(dispute.description)}` : ''}`,
        'error',
      )}
      ${this.infoBox('Please review this dispute and respond promptly to help resolve it.', 'warning')}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(link, 'Review dispute', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'New Dispute', `New dispute on order #${orderId}.`);
  }

  async getDisputeResolvedEmail(opts: { dispute: any; order: any; portal: 'customer' | 'seller' }): Promise<string> {
    const { dispute, order, portal } = opts;
    const orderId = order?.orderNumber || (order?._id ? order._id.toString().slice(-8) : 'N/A');
    const { primary, primaryAlt } = await this.colors();
    const link = portal === 'seller' ? `${this.frontend()}/seller/disputes` : `${this.frontend()}/orders/${order?._id || ''}`;

    const content = `
      ${await this.hero('✅', 'Dispute resolved', `Your dispute on order #${this.h(orderId)} has been resolved.`)}
      ${this.infoBox(
        `<strong>Resolution:</strong> ${this.h(String(dispute.resolution || 'resolved').replace(/_/g, ' '))}` +
        `${dispute.resolutionNotes ? `<br><br><strong>Notes:</strong> ${this.h(dispute.resolutionNotes)}` : ''}`,
        'success',
      )}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(link, 'View details', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'Dispute Resolved', `Your dispute on order #${orderId} is resolved.`);
  }

  async getReviewNotificationEmail(opts: {
    sellerName: string;
    productName: string;
    productId: string;
    rating?: number;
    title?: string;
    comment?: string;
  }): Promise<string> {
    const { primary, primaryAlt } = await this.colors();
    const rating = Math.max(0, Math.min(5, Math.round(opts.rating || 0)));
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);

    const content = `
      ${await this.hero('⭐', 'New product review', `Hi ${this.h(opts.sellerName)}, a customer reviewed your product.`)}
      ${this.paragraph(`<strong style="color:${EmailTemplatesService.T.fg};">${this.h(opts.productName)}</strong>`)}
      <div style="margin:8px 0 18px;font-size:22px;color:#f59e0b;letter-spacing:2px;">${stars}</div>
      ${(opts.title || opts.comment) ? this.infoBox(
        `${opts.title ? `<strong>${this.h(opts.title)}</strong><br>` : ''}${opts.comment ? `<em>&ldquo;${this.h(opts.comment)}&rdquo;</em>` : ''}`,
        'accent', primary,
      ) : ''}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${this.frontend()}/seller/products/${opts.productId}`, 'View product', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'New Review', `New ${rating}-star review on ${opts.productName}.`);
  }

  async getAccountStatusEmail(
    status: 'active' | 'inactive' | 'suspended',
    name: string,
    reason?: string,
  ): Promise<string> {
    const frontendUrl = this.frontend();
    const siteName = this.h(await this.getSiteName());
    const { primary, primaryAlt } = await this.colors();
    const reactivated = status === 'active';
    const emoji = reactivated ? '✅' : status === 'suspended' ? '🚫' : '⏸️';
    const title = reactivated
      ? 'Your account is active again'
      : status === 'suspended'
        ? 'Your account has been suspended'
        : 'Your account has been deactivated';
    const variant: 'success' | 'error' = reactivated ? 'success' : 'error';
    const body = reactivated
      ? `Good news, ${this.h(name)}! Your ${siteName} account has been reactivated and you have full access again.`
      : `Hi ${this.h(name)}, your ${siteName} account has been ${status === 'suspended' ? 'suspended' : 'deactivated'}.` +
        `${reason ? `<br><br><strong>Reason:</strong> ${this.h(reason)}` : ''}` +
        `<br><br>If you believe this is a mistake, please contact our support team.`;

    const content = `
      ${await this.hero(emoji, title)}
      ${this.infoBox(body, variant)}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(
          reactivated ? `${frontendUrl}/login` : `${frontendUrl}/contact`,
          reactivated ? 'Sign in' : 'Contact support',
          primary, primaryAlt,
        )}
      </div>`;

    return this.getBaseTemplate(content, 'Account Status Update', title);
  }

  async getProductSubmittedEmail(productName: string): Promise<string> {
    const { primary, primaryAlt } = await this.colors();

    const content = `
      ${await this.hero('📦', 'Product submitted for review')}
      ${this.infoBox(
        `Your product <strong>${this.h(productName)}</strong> has been submitted and is now pending review. We&apos;ll email you as soon as it&apos;s approved and live on the store.`,
        'warning',
      )}
      <div style="text-align:center;margin:28px 0;">
        ${this.button(`${this.frontend()}/seller/products`, 'View your products', primary, primaryAlt)}
      </div>`;

    return this.getBaseTemplate(content, 'Product Submitted', `Your product "${productName}" is pending review.`);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getCurrencySymbol(currency: string): string {
    const symbols: Record<string, string> = {
      USD: '$', EUR: '€', GBP: '£', INR: '₹', CAD: 'C$', AUD: 'A$', JPY: '¥',
    };
    return symbols[currency.toUpperCase()] || '₹';
  }

  private getStatusEmoji(status: string): string {
    const emojis: Record<string, string> = {
      pending: '⏳', processing: '🔄', shipped: '📦', delivered: '✅', cancelled: '❌', refunded: '💰',
    };
    return emojis[status.toLowerCase()] || '📋';
  }

  /** Map an order status to a design-system info-box variant. */
  private getStatusVariant(status: string): 'accent' | 'success' | 'warning' | 'error' | 'info' {
    const map: Record<string, 'accent' | 'success' | 'warning' | 'error' | 'info'> = {
      pending: 'warning',
      processing: 'info',
      shipped: 'info',
      delivered: 'success',
      cancelled: 'error',
      refunded: 'accent',
    };
    return map[status.toLowerCase()] || 'accent';
  }
}
