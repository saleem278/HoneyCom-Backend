import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as nodemailer from 'nodemailer';
import { ISettings } from '../models/Settings.model';
import { EmailTemplatesService } from './email-templates.service';
import * as dns from 'dns';
dns.setDefaultResultOrder('ipv4first');
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly templates: EmailTemplatesService;

  constructor(
    private configService: ConfigService,
    @InjectModel('Settings') private settingsModel: Model<ISettings>,
  ) {
    this.templates = new EmailTemplatesService(configService, settingsModel);

    const smtpHost = configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
    const smtpPort = parseInt(configService.get<string>('SMTP_PORT') || '587');
    const smtpUser = configService.get<string>('SMTP_USER');
    const smtpPassword = configService.get<string>('SMTP_PASSWORD');

    if (smtpUser && smtpPassword) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: false,
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        tls: {
          servername: smtpHost,
        },
        logger: true,
        debug: true,
      });
      this.transporter.verify((error) => {
        if (error) this.logger.error(`SMTP connection failed: ${error.message}`);
        else this.logger.log(`SMTP server is ready to send emails (${smtpHost}:${smtpPort} as ${smtpUser})`);
      });
    } else {
      this.logger.warn('SMTP not configured. Set SMTP_USER and SMTP_PASSWORD.');
    }
  }

  async sendEmail(options: { to: string; subject: string; html: string; text?: string }): Promise<void> {
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPassword = this.configService.get<string>('SMTP_PASSWORD');
    if (!smtpUser || !smtpPassword || !this.transporter) {
      throw new Error('SMTP not configured');
    }
    const fromEmail = this.configService.get<string>('SMTP_FROM') || smtpUser;
    try {
      const info = await this.transporter.sendMail({
        from: fromEmail, to: options.to, subject: options.subject,
        html: options.html, text: options.text,
      });
      this.logger.log(`Email sent to ${options.to} (messageId=${info.messageId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Email send failed to ${options.to}: ${message}`);
      throw new Error(`SMTP send failed: ${message}`);
    }
  }

  /** Read brand name from settings for email subjects. */
  private async siteName(): Promise<string> {
    return this.templates.getSiteName();
  }

  /** Read email settings (subjects, CTAs) from DB — 5-min cache via templates service. */
  private async emailSubject(key: string, fallback: string): Promise<string> {
    // Delegate to the templates service which already owns the email settings cache
    return this.templates.getEmailSetting(key, fallback);
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const name = await this.siteName();
    const subject = await this.emailSubject('verifySubject', `Verify Your Email Address — ${name}`);
    await this.sendEmail({
      to: email,
      subject: subject.replace('{{siteName}}', name),
      html: await this.templates.getVerificationEmail(token),
    });
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const name = await this.siteName();
    const subject = await this.emailSubject('resetSubject', `Reset Your Password — ${name}`);
    await this.sendEmail({
      to: email,
      subject: subject.replace('{{siteName}}', name),
      html: await this.templates.getPasswordResetEmail(token),
    });
  }

  async sendOrderConfirmationEmail(email: string, order: any): Promise<void> {
    const name = await this.siteName();
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const subjectTpl = await this.emailSubject('orderConfirmSubject', `Order Confirmed #{{orderNumber}} — ${name}`);
    await this.sendEmail({
      to: email,
      subject: subjectTpl.replace('{{orderNumber}}', orderId).replace('{{siteName}}', name),
      html: await this.templates.getOrderConfirmationEmail(order),
    });
  }

  async sendOrderStatusUpdateEmail(email: string, order: any): Promise<void> {
    const name = await this.siteName();
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    const subjectTpl = await this.emailSubject('shippingSubject', `Order Update #{{orderNumber}} — ${name}`);
    await this.sendEmail({
      to: email,
      subject: subjectTpl.replace('{{orderNumber}}', orderId).replace('{{siteName}}', name),
      html: await this.templates.getOrderStatusUpdateEmail(order),
    });
  }

  async sendSellerApprovalEmail(email: string, sellerName: string): Promise<void> {
    const name = await this.siteName();
    const subject = await this.emailSubject('sellerApprovedSubject', `Seller Account Approved — Welcome to ${name}!`);
    await this.sendEmail({
      to: email,
      subject: subject.replace('{{siteName}}', name),
      html: await this.templates.getSellerApprovalEmail(sellerName),
    });
  }

  async sendSellerRejectionEmail(email: string, sellerName: string, reason?: string): Promise<void> {
    const name = await this.siteName();
    const subject = await this.emailSubject('sellerRejectedSubject', `Seller Account Application Status — ${name}`);
    await this.sendEmail({
      to: email,
      subject: subject.replace('{{siteName}}', name),
      html: await this.templates.getSellerRejectionEmail(sellerName, reason),
    });
  }

  private h(str: unknown): string {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  async sendProductApprovalEmail(email: string, productName: string): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: email,
      subject: `Your product is live — ${name}`,
      html: await this.templates.getProductApprovalEmail(productName),
    });
  }

  async sendProductRejectionEmail(email: string, productName: string, reason?: string): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: email,
      subject: `Your product was not approved — ${name}`,
      html: await this.templates.getProductRejectionEmail(productName, reason),
    });
  }

  /** Send a contact-form submission to the configured support email. */
  async sendContactEmail(opts: {
    fromName: string;
    fromEmail: string;
    subject: string;
    message: string;
  }): Promise<void> {
    const siteName = await this.siteName();
    // Resolve destination from DB settings, fall back to SMTP_USER
    const settings = await this.settingsModel.findOne({ key: 'branding.supportEmail' }).lean();
    const to: string = (settings?.value as string) || this.configService.get<string>('SMTP_USER') || '';
    if (!to) throw new Error('No support email configured');
    await this.sendEmail({
      to,
      subject: `[${siteName} Contact] ${this.h(opts.subject)}`,
      html: await this.templates.getContactEmail(opts),
      text: `From: ${opts.fromName} <${opts.fromEmail}>\nSubject: ${opts.subject}\n\n${opts.message}`,
    });
  }

  /** Notify a seller when a customer asks a question about their product. */
  async sendProductQuestionEmail(opts: {
    sellerEmail: string;
    sellerName: string;
    productName: string;
    productId: string;
    question: string;
    customerEmail?: string;
  }): Promise<void> {
    await this.sendEmail({
      to: opts.sellerEmail,
      subject: `New question on your product: ${this.h(opts.productName)}`,
      html: await this.templates.getProductQuestionEmail(opts),
    });
  }

  /** Notify admins when a new seller registers and is awaiting approval. */
  async sendNewSellerNotificationEmail(opts: {
    to: string;
    sellerName: string;
    sellerEmail: string;
    storeName?: string;
  }): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: opts.to,
      subject: `New seller registration — pending approval — ${name}`,
      html: await this.templates.getNewSellerNotificationEmail(opts),
    });
  }

  /** Welcome email sent once a customer verifies their email address. */
  async sendWelcomeEmail(email: string): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: email,
      subject: `Welcome to ${name}!`,
      html: await this.templates.getWelcomeEmail(),
    });
  }

  /** Security confirmation after a password reset (link) or change (logged-in). */
  async sendPasswordChangedEmail(email: string, context: 'reset' | 'changed' = 'changed'): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: email,
      subject: `Your password was ${context === 'reset' ? 'reset' : 'changed'} — ${name}`,
      html: await this.templates.getPasswordChangedEmail(context),
    });
  }

  /** Notify a customer that a refund has been processed for their order. */
  async sendOrderRefundedEmail(email: string, order: any, amount?: number, reason?: string): Promise<void> {
    const name = await this.siteName();
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    await this.sendEmail({
      to: email,
      subject: `Refund processed for order #${orderId} — ${name}`,
      html: await this.templates.getRefundProcessedEmail(order, amount, reason),
    });
  }

  /** Notify a customer that their payment failed and the order was cancelled. */
  async sendPaymentFailedEmail(email: string, order: any): Promise<void> {
    const name = await this.siteName();
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    await this.sendEmail({
      to: email,
      subject: `Payment failed for order #${orderId} — ${name}`,
      html: await this.templates.getPaymentFailedEmail(order),
    });
  }

  /** Notify a seller that they have received a new order. */
  async sendNewOrderToSellerEmail(opts: { to: string; sellerName: string; order: any; items: any[] }): Promise<void> {
    const orderId = opts.order.orderNumber || (opts.order._id ? opts.order._id.toString().slice(-8) : 'N/A');
    await this.sendEmail({
      to: opts.to,
      subject: `New order received #${orderId}`,
      html: await this.templates.getNewOrderSellerEmail({ sellerName: opts.sellerName, order: opts.order, items: opts.items }),
    });
  }

  /** Confirm to a customer that their dispute has been received. */
  async sendDisputeConfirmationEmail(email: string, dispute: any, order: any): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: email,
      subject: `We received your dispute — ${name}`,
      html: await this.templates.getDisputeConfirmationEmail(dispute, order),
    });
  }

  /** Alert a seller or admin that a new dispute has been raised. */
  async sendDisputeAlertEmail(opts: { to: string; dispute: any; order: any; portal: 'seller' | 'admin' }): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: opts.to,
      subject: `New dispute raised — ${name}`,
      html: await this.templates.getDisputeAlertEmail({ dispute: opts.dispute, order: opts.order, portal: opts.portal }),
    });
  }

  /** Notify a customer or seller that a dispute has been resolved. */
  async sendDisputeResolvedEmail(opts: { to: string; dispute: any; order: any; portal: 'customer' | 'seller' }): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: opts.to,
      subject: `Your dispute has been resolved — ${name}`,
      html: await this.templates.getDisputeResolvedEmail({ dispute: opts.dispute, order: opts.order, portal: opts.portal }),
    });
  }

  /** Notify a seller that a customer left a review on their product. */
  async sendReviewNotificationEmail(opts: {
    to: string;
    sellerName: string;
    productName: string;
    productId: string;
    rating?: number;
    title?: string;
    comment?: string;
  }): Promise<void> {
    await this.sendEmail({
      to: opts.to,
      subject: `New review on ${opts.productName}`,
      html: await this.templates.getReviewNotificationEmail(opts),
    });
  }

  /** Notify a user that their account status changed (suspended/deactivated/reactivated). */
  async sendAccountStatusEmail(
    email: string,
    status: 'active' | 'inactive' | 'suspended',
    name: string,
    reason?: string,
  ): Promise<void> {
    const siteName = await this.siteName();
    await this.sendEmail({
      to: email,
      subject: `Account status update — ${siteName}`,
      html: await this.templates.getAccountStatusEmail(status, name, reason),
    });
  }

  /** Confirm to a seller that their product was submitted and is pending review. */
  async sendProductSubmittedEmail(email: string, productName: string): Promise<void> {
    const name = await this.siteName();
    await this.sendEmail({
      to: email,
      subject: `Product submitted for review — ${name}`,
      html: await this.templates.getProductSubmittedEmail(productName),
    });
  }

  // ── Payout notifications (PAY-07) ────────────────────────────────────────

  /** Notify a seller that their payout request was approved. */
  async sendPayoutApprovedEmail(email: string, opts: { sellerName: string; amount: number; currency: string; adminNotes?: string }): Promise<void> {
    const name = await this.siteName();
    const amtStr = `${opts.currency} ${Number(opts.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await this.sendEmail({
      to: email,
      subject: `Payout approved: ${amtStr} — ${name}`,
      html: await this.templates.getPayoutApprovedEmail(opts),
    });
  }

  /** Notify a seller that their payout request was rejected. */
  async sendPayoutRejectedEmail(email: string, opts: { sellerName: string; amount: number; currency: string; rejectionReason: string; adminNotes?: string }): Promise<void> {
    const name = await this.siteName();
    const amtStr = `${opts.currency} ${Number(opts.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await this.sendEmail({
      to: email,
      subject: `Payout request rejected: ${amtStr} — ${name}`,
      html: await this.templates.getPayoutRejectedEmail(opts),
    });
  }

  /** Notify a seller that their payout has been transferred. */
  async sendPayoutPaidEmail(email: string, opts: { sellerName: string; amount: number; currency: string; adminNotes?: string }): Promise<void> {
    const name = await this.siteName();
    const amtStr = `${opts.currency} ${Number(opts.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await this.sendEmail({
      to: email,
      subject: `Payout transferred: ${amtStr} — ${name}`,
      html: await this.templates.getPayoutPaidEmail(opts),
    });
  }
}
