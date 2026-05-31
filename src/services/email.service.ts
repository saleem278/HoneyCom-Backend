import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailTemplatesService } from './email-templates.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private templatesService: EmailTemplatesService;

  constructor(private configService: ConfigService) {
    this.templatesService = new EmailTemplatesService(configService);

    const smtpHost = configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
    const smtpPort = parseInt(configService.get<string>('SMTP_PORT') || '587');
    const smtpUser = configService.get<string>('SMTP_USER');
    const smtpPassword = configService.get<string>('SMTP_PASSWORD');

    if (smtpUser && smtpPassword) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
      });

      this.transporter.verify((error) => {
        if (error) {
          this.logger.error(`SMTP connection failed: ${error.message}`);
        } else {
          this.logger.log('SMTP server is ready to send emails');
        }
      });
    } else {
      this.logger.warn('SMTP not configured. Email functionality will not work. Set SMTP_USER and SMTP_PASSWORD.');
    }
  }

  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    // Check if SMTP is configured
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPassword = this.configService.get<string>('SMTP_PASSWORD');
    
    if (!smtpUser || !smtpPassword) {
      throw new Error('SMTP not configured. Please set SMTP_USER and SMTP_PASSWORD in .env file');
    }

    try {
      const fromEmail = this.configService.get<string>('SMTP_FROM') || smtpUser;
      
      const info = await this.transporter.sendMail({
        from: fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      
      this.logger.log(`Email sent to ${options.to} (messageId=${info.messageId})`);
    } catch (error: any) {
      this.logger.error(
        `Email sending failed (to=${options.to}, subject=${options.subject}, code=${error.code}): ${error.message || error}`,
      );
      throw error;
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Verify Your Email Address - HoneyCom',
      html: this.templatesService.getVerificationEmail(token),
    });
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Reset Your Password - HoneyCom',
      html: this.templatesService.getPasswordResetEmail(token),
    });
  }

  async sendOrderConfirmationEmail(email: string, order: any): Promise<void> {
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    await this.sendEmail({
      to: email,
      subject: `Order Confirmation - #${orderId} - HoneyCom`,
      html: this.templatesService.getOrderConfirmationEmail(order),
    });
  }

  async sendOrderStatusUpdateEmail(email: string, order: any): Promise<void> {
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    await this.sendEmail({
      to: email,
      subject: `Order Update - #${orderId} - HoneyCom`,
      html: this.templatesService.getOrderStatusUpdateEmail(order),
    });
  }

  async sendSellerApprovalEmail(email: string, sellerName: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Seller Account Approved - Welcome to HoneyCom!',
      html: this.templatesService.getSellerApprovalEmail(sellerName),
    });
  }

  async sendSellerRejectionEmail(email: string, sellerName: string, reason?: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Seller Account Application Status - HoneyCom',
      html: this.templatesService.getSellerRejectionEmail(sellerName, reason),
    });
  }

  private h(str: unknown): string {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  async sendProductApprovalEmail(email: string, productName: string): Promise<void> {
    const safeName = this.h(productName);
    await this.sendEmail({
      to: email,
      subject: `Your product has been approved`,
      html: `
        <h2>Product approved</h2>
        <p>Your product <strong>${safeName}</strong> has been approved and is now live on HoneyCom marketplace.</p>
        <p>Customers can now find and purchase it.</p>
      `,
    });
  }

  async sendProductRejectionEmail(email: string, productName: string, reason?: string): Promise<void> {
    const safeName = this.h(productName);
    const safeReason = reason ? this.h(reason) : null;
    const reasonBlock = safeReason
      ? `<p><strong>Reason:</strong> ${safeReason}</p>`
      : '<p>Please review the listing guidelines and contact support if you have questions.</p>';
    await this.sendEmail({
      to: email,
      subject: `Your product was not approved`,
      html: `
        <h2>Product not approved</h2>
        <p>Your product <strong>${safeName}</strong> was not approved for listing.</p>
        ${reasonBlock}
      `,
    });
  }
}
