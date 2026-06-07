import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as nodemailer from 'nodemailer';
import { ISettings } from '../models/Settings.model';
import { EmailTemplatesService } from './email-templates.service';

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

    const smtpHost     = configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
    const smtpPort     = parseInt(configService.get<string>('SMTP_PORT') || '587');
    const smtpUser     = configService.get<string>('SMTP_USER');
    const smtpPassword = configService.get<string>('SMTP_PASSWORD');

    if (smtpUser && smtpPassword) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPassword },
      });
      this.transporter.verify((error) => {
        if (error) this.logger.error(`SMTP connection failed: ${error.message}`);
        else this.logger.log('SMTP server is ready to send emails');
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
    const info = await this.transporter.sendMail({
      from: fromEmail, to: options.to, subject: options.subject,
      html: options.html, text: options.text,
    });
    this.logger.log(`Email sent to ${options.to} (messageId=${info.messageId})`);
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
    const settings = await this.settingsModel.findOne({ key: 'supportEmail' }).lean();
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
}
