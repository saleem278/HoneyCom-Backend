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
 */
@Injectable()
export class EmailTemplatesService {
  constructor(
    private configService: ConfigService,
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
  ) {}

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

  // ── Base template ─────────────────────────────────────────────────────────
  private async getBaseTemplate(content: string, title: string): Promise<string> {
    const b = await this.brand();
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const siteName   = this.h(b.siteName   || 'Our Store');
    const tagline    = this.h(b.tagline    || '');
    const logoEmoji  = this.h(b.logoEmoji  || '🛒');
    const primary    = b.primaryColor || '#f97316';
    const primaryAlt = b.primaryColorAlt || '#f59e0b';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.h(title)} - ${siteName}</title>
  <!--[if mso]><style>body,table,td{font-family:Arial,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Roboto','Helvetica Neue',sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:12px;box-shadow:0 4px 6px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,${primaryAlt} 0%,${primary} 50%,${primaryAlt} 100%);padding:40px 30px;text-align:center;border-radius:12px 12px 0 0;">
              <h1 style="margin:0;color:#ffffff;font-size:32px;font-weight:700;letter-spacing:-0.5px;">
                ${logoEmoji} ${siteName}
              </h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:40px 30px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:30px;background-color:#f9fafb;border-radius:0 0 12px 12px;border-top:1px solid #e5e7eb;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align:center;padding-bottom:20px;">
                    <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">
                      <strong style="color:${primary};">${siteName}</strong><br>
                      ${tagline}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="text-align:center;padding-bottom:20px;">
                    <a href="${frontendUrl}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,${primaryAlt} 0%,${primary} 100%);color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Visit Our Store</a>
                  </td>
                </tr>
                <tr>
                  <td style="text-align:center;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                      This email was sent by ${siteName}.<br>
                      If you have questions, please contact our support team.
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

  // ── Public template methods (all async now) ────────────────────────────────

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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const verificationUrl = `${frontendUrl}/verify-email?token=${token}`;
    const siteName = this.h(await this.getSiteName());
    const et = await this.emailSettings();
    const ctaText = this.h(et.verifyCta || 'Verify Email Address');
    const intro = this.h(et.verifyIntro || `Welcome to ${siteName}! Please verify your email to start shopping.`);

    const content = `
      <div style="text-align:center;margin-bottom:30px;">
        <div style="width:80px;height:80px;margin:0 auto 20px;background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);border-radius:50%;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:40px;">✉️</span>
        </div>
        <h2 style="margin:0 0 10px;color:#1f2937;font-size:28px;font-weight:700;">Welcome to ${siteName}!</h2>
        <p style="margin:0;color:#6b7280;font-size:16px;">${intro}</p>
      </div>
      <div style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:20px;border-radius:8px;margin-bottom:30px;">
        <p style="margin:0;color:#78350f;font-size:15px;line-height:1.6;">
          <strong>Almost there!</strong> Please verify your email address to complete your registration and start shopping.
        </p>
      </div>
      <div style="text-align:center;margin:30px 0;">
        <a href="${verificationUrl}" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#f59e0b 0%,#f97316 100%);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">
          ${ctaText}
        </a>
      </div>
      <div style="margin-top:30px;padding-top:30px;border-top:1px solid #e5e7eb;">
        <p style="margin:0 0 15px;color:#6b7280;font-size:14px;line-height:1.6;">
          <strong>Having trouble clicking the button?</strong> Copy and paste this link into your browser:
        </p>
        <p style="margin:0;word-break:break-all;">
          <a href="${verificationUrl}" style="color:#f97316;text-decoration:underline;font-size:13px;">${verificationUrl}</a>
        </p>
      </div>
      <div style="margin-top:25px;padding:15px;background-color:#fef3c7;border-radius:8px;">
        <p style="margin:0;color:#78350f;font-size:13px;line-height:1.5;">
          ⏰ <strong>This link will expire in 24 hours.</strong> If you didn&apos;t create an account, please ignore this email.
        </p>
      </div>`;

    return this.getBaseTemplate(content, 'Verify Your Email');
  }

  async getPasswordResetEmail(token: string): Promise<string> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    const content = `
      <div style="text-align:center;margin-bottom:30px;">
        <span style="font-size:60px;">🔒</span>
        <h2 style="margin:10px 0;color:#1f2937;font-size:28px;font-weight:700;">Reset Your Password</h2>
        <p style="margin:0;color:#6b7280;font-size:16px;">We received a request to reset your password</p>
      </div>
      <div style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:20px;border-radius:8px;margin-bottom:30px;">
        <p style="margin:0;color:#78350f;font-size:15px;line-height:1.6;">
          Click the button below to reset your password. If you didn&apos;t request this, you can safely ignore this email.
        </p>
      </div>
      <div style="text-align:center;margin:30px 0;">
        <a href="${resetUrl}" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#f59e0b 0%,#f97316 100%);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">
          Reset Password
        </a>
      </div>
      <div style="margin-top:30px;padding-top:30px;border-top:1px solid #e5e7eb;">
        <p style="margin:0 0 15px;color:#6b7280;font-size:14px;line-height:1.6;">
          <strong>Having trouble?</strong> Copy and paste this link into your browser:
        </p>
        <p style="margin:0;word-break:break-all;">
          <a href="${resetUrl}" style="color:#f97316;text-decoration:underline;font-size:13px;">${resetUrl}</a>
        </p>
      </div>
      <div style="margin-top:25px;padding:15px;background-color:#fef3c7;border-radius:8px;">
        <p style="margin:0;color:#78350f;font-size:13px;line-height:1.5;">
          ⏰ <strong>This link will expire in 1 hour.</strong> For security, don&apos;t share this link.
        </p>
      </div>`;

    return this.getBaseTemplate(content, 'Reset Your Password');
  }

  async getOrderConfirmationEmail(order: any): Promise<string> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const orderUrl = `${frontendUrl}/orders/${order._id || ''}`;
    const currency = order.currency || 'INR';
    const currencySymbol = this.getCurrencySymbol(currency);

    const itemsHtml = (order.items || []).map((item: any) => `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #e5e7eb;">
          <p style="margin:0;color:#1f2937;font-weight:600;font-size:15px;">${this.h(item.name || 'Product')}</p>
          <p style="margin:5px 0 0;color:#6b7280;font-size:13px;">Qty: ${this.h(item.quantity || 1)}</p>
        </td>
        <td style="padding:12px;text-align:right;border-bottom:1px solid #e5e7eb;">
          <p style="margin:0;color:#1f2937;font-weight:600;font-size:15px;">${currencySymbol}${(item.price || 0).toFixed(0)}</p>
        </td>
      </tr>`).join('');

    const content = `
      <div style="text-align:center;margin-bottom:30px;">
        <span style="font-size:60px;">✅</span>
        <h2 style="margin:10px 0;color:#1f2937;font-size:28px;font-weight:700;">Order Confirmed!</h2>
        <p style="margin:0;color:#6b7280;font-size:16px;">Thank you for your order</p>
      </div>
      <div style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%);padding:20px;border-radius:10px;margin-bottom:30px;text-align:center;">
        <p style="margin:0;color:#78350f;font-size:18px;font-weight:600;">Order #${this.h(orderId)}</p>
      </div>
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:30px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <thead>
            <tr style="background-color:#f9fafb;">
              <th style="padding:12px;text-align:left;color:#374151;font-weight:600;font-size:14px;border-bottom:2px solid #e5e7eb;">Item</th>
              <th style="padding:12px;text-align:right;color:#374151;font-weight:600;font-size:14px;border-bottom:2px solid #e5e7eb;">Price</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
      </div>
      <div style="background-color:#f9fafb;padding:20px;border-radius:10px;margin-bottom:30px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Subtotal:</td><td style="padding:8px 0;text-align:right;color:#1f2937;font-size:14px;font-weight:600;">${currencySymbol}${(order.subtotal||0).toFixed(0)}</td></tr>
          ${order.tax ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Tax:</td><td style="padding:8px 0;text-align:right;color:#1f2937;font-size:14px;font-weight:600;">${currencySymbol}${order.tax.toFixed(0)}</td></tr>` : ''}
          ${order.shipping ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">Shipping:</td><td style="padding:8px 0;text-align:right;color:#1f2937;font-size:14px;font-weight:600;">${currencySymbol}${order.shipping.toFixed(0)}</td></tr>` : ''}
          ${order.discount ? `<tr><td style="padding:8px 0;color:#10b981;font-size:14px;">Discount:</td><td style="padding:8px 0;text-align:right;color:#10b981;font-size:14px;font-weight:600;">-${currencySymbol}${order.discount.toFixed(0)}</td></tr>` : ''}
          <tr style="border-top:2px solid #e5e7eb;"><td style="padding:12px 0 0;color:#1f2937;font-size:18px;font-weight:700;">Total:</td><td style="padding:12px 0 0;text-align:right;color:#f97316;font-size:20px;font-weight:700;">${currencySymbol}${(order.total||0).toFixed(0)}</td></tr>
        </table>
      </div>
      <div style="text-align:center;margin:30px 0;">
        <a href="${orderUrl}" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#f59e0b 0%,#f97316 100%);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">View Order Details</a>
      </div>
      <div style="background-color:#ecfdf5;border-left:4px solid #10b981;padding:15px;border-radius:8px;margin-top:25px;">
        <p style="margin:0;color:#065f46;font-size:14px;line-height:1.6;">
          <strong>📦 What&apos;s next?</strong> We&apos;ll send you another email when your order ships. Track your order anytime from your account.
        </p>
      </div>`;

    return this.getBaseTemplate(content, `Order Confirmation - #${orderId}`);
  }

  async getOrderStatusUpdateEmail(order: any): Promise<string> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const orderUrl = `${frontendUrl}/orders/${order._id || ''}`;
    const status = order.status || 'updated';
    const statusEmoji = this.getStatusEmoji(status);
    const statusColor = this.getStatusColor(status);

    const content = `
      <div style="text-align:center;margin-bottom:30px;">
        <span style="font-size:60px;">${statusEmoji}</span>
        <h2 style="margin:10px 0;color:#1f2937;font-size:28px;font-weight:700;">Order Status Updated</h2>
      </div>
      <div style="background:${statusColor};padding:20px;border-radius:10px;margin-bottom:30px;text-align:center;">
        <p style="margin:0;color:#ffffff;font-size:20px;font-weight:600;text-transform:capitalize;">${statusEmoji} ${this.h(status)}</p>
        <p style="margin:10px 0 0;color:#ffffff;font-size:16px;opacity:0.9;">Order #${this.h(orderId)}</p>
      </div>
      ${order.trackingNumber ? `
      <div style="background-color:#f0f9ff;border-left:4px solid #0ea5e9;padding:20px;border-radius:8px;margin-bottom:30px;">
        <p style="margin:0 0 10px;color:#0c4a6e;font-weight:600;font-size:15px;">📦 Tracking Information</p>
        <p style="margin:0;color:#075985;font-size:14px;line-height:1.6;">
          <strong>Tracking Number:</strong> ${this.h(order.trackingNumber)}<br>
          ${order.carrier ? `<strong>Carrier:</strong> ${this.h(order.carrier)}` : ''}
        </p>
      </div>` : ''}
      <div style="text-align:center;margin:30px 0;">
        <a href="${orderUrl}" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#f59e0b 0%,#f97316 100%);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">View Order Details</a>
      </div>`;

    return this.getBaseTemplate(content, `Order Update - #${orderId}`);
  }

  async getSellerApprovalEmail(sellerName: string): Promise<string> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const siteName = this.h(await this.getSiteName());

    const content = `
      <div style="text-align:center;margin-bottom:30px;">
        <span style="font-size:60px;">🎉</span>
        <h2 style="margin:10px 0;color:#1f2937;font-size:28px;font-weight:700;">Congratulations, ${this.h(sellerName)}!</h2>
        <p style="margin:0;color:#6b7280;font-size:16px;">Your seller account has been approved</p>
      </div>
      <div style="background:linear-gradient(135deg,#d1fae5 0%,#a7f3d0 100%);padding:25px;border-radius:10px;margin-bottom:30px;">
        <p style="margin:0;color:#065f46;font-size:16px;line-height:1.8;text-align:center;">
          <strong style="font-size:18px;">Welcome to ${siteName}!</strong><br>
          Your seller account has been approved. Start listing your products and reach thousands of customers.
        </p>
      </div>
      <div style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:20px;border-radius:8px;margin-bottom:30px;">
        <p style="margin:0 0 15px;color:#78350f;font-weight:600;font-size:15px;">🚀 What you can do now:</p>
        <ul style="margin:0;padding-left:20px;color:#78350f;font-size:14px;line-height:1.8;">
          <li>Add and manage your products</li>
          <li>Track your orders and sales</li>
          <li>View detailed analytics and insights</li>
          <li>Manage your store profile and settings</li>
        </ul>
      </div>
      <div style="text-align:center;margin:30px 0;">
        <a href="${frontendUrl}/seller" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#f59e0b 0%,#f97316 100%);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">Access Seller Dashboard</a>
      </div>
      <div style="background-color:#ecfdf5;border-left:4px solid #10b981;padding:15px;border-radius:8px;margin-top:25px;">
        <p style="margin:0;color:#065f46;font-size:14px;line-height:1.6;">
          💡 <strong>Need help?</strong> Our support team is here. If you have questions about selling, don&apos;t hesitate to reach out.
        </p>
      </div>`;

    return this.getBaseTemplate(content, 'Seller Account Approved');
  }

  async getSellerRejectionEmail(sellerName: string, reason?: string): Promise<string> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const siteName = this.h(await this.getSiteName());

    const content = `
      <div style="text-align:center;margin-bottom:30px;">
        <span style="font-size:60px;">📋</span>
        <h2 style="margin:10px 0;color:#1f2937;font-size:28px;font-weight:700;">Seller Application Status</h2>
      </div>
      <div style="background-color:#fef2f2;border-left:4px solid #ef4444;padding:20px;border-radius:8px;margin-bottom:30px;">
        <p style="margin:0;color:#991b1b;font-size:15px;line-height:1.6;">
          Dear ${this.h(sellerName)},<br><br>
          We regret to inform you that your seller account application has not been approved at this time.
          ${reason ? `<br><br><strong>Reason:</strong> ${this.h(reason)}` : ''}
        </p>
      </div>
      <div style="background-color:#fffbeb;border-left:4px solid #f59e0b;padding:20px;border-radius:8px;margin-bottom:30px;">
        <p style="margin:0;color:#78350f;font-size:14px;line-height:1.8;">
          If you believe this is an error or would like to reapply with additional information, please contact our support team.
        </p>
      </div>
      <div style="text-align:center;margin:30px 0;">
        <a href="${frontendUrl}/contact" style="display:inline-block;padding:16px 32px;background:linear-gradient(135deg,#f59e0b 0%,#f97316 100%);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:16px;">Contact Support</a>
      </div>
      <div style="background-color:#f9fafb;padding:15px;border-radius:8px;margin-top:25px;">
        <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;text-align:center;">
          Thank you for your interest in selling on <strong style="color:#f97316;">${siteName}</strong>. We appreciate your understanding.
        </p>
      </div>`;

    return this.getBaseTemplate(content, 'Seller Account Application Status');
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

  private getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      pending: 'linear-gradient(135deg,#fef3c7 0%,#fde68a 100%)',
      processing: 'linear-gradient(135deg,#dbeafe 0%,#bfdbfe 100%)',
      shipped: 'linear-gradient(135deg,#dbeafe 0%,#93c5fd 100%)',
      delivered: 'linear-gradient(135deg,#d1fae5 0%,#a7f3d0 100%)',
      cancelled: 'linear-gradient(135deg,#fee2e2 0%,#fecaca 100%)',
      refunded: 'linear-gradient(135deg,#e0e7ff 0%,#c7d2fe 100%)',
    };
    return colors[status.toLowerCase()] || 'linear-gradient(135deg,#f3f4f6 0%,#e5e7eb 100%)';
  }
}
