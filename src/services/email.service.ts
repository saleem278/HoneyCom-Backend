import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailTemplatesService } from './email-templates.service';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private templatesService: EmailTemplatesService;

  constructor(private configService: ConfigService) {
    this.templatesService = new EmailTemplatesService(configService);
    
    const smtpHost = configService.get<string>('SMTP_HOST') || 'smtp.gmail.com';
    const smtpPort = parseInt(configService.get<string>('SMTP_PORT') || '587');
    const smtpUser = configService.get<string>('SMTP_USER');
    const smtpPassword = configService.get<string>('SMTP_PASSWORD');

    // Only create transporter if credentials are provided
    if (smtpUser && smtpPassword) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465, // true for 465, false for other ports
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
      });
      
      // Verify connection
      this.transporter.verify((error, success) => {
        if (error) {
          console.error('SMTP connection failed:', error.message);
        } else {
          console.log('SMTP server is ready to send emails');
        }
      });
    } else {
      console.warn('⚠️  SMTP not configured. Email functionality will not work.');
      console.warn('   Please set SMTP_USER and SMTP_PASSWORD in your .env file');
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
      
      console.log(`Email sent successfully to ${options.to}. Message ID: ${info.messageId}`);
    } catch (error: any) {
      console.error('Email sending failed:', {
        to: options.to,
        subject: options.subject,
        error: error.message || error,
        code: error.code,
      });
      throw error;
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Verify Your Email Address - Honey Store',
      html: this.templatesService.getVerificationEmail(token),
    });
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Reset Your Password - Honey Store',
      html: this.templatesService.getPasswordResetEmail(token),
    });
  }

  async sendOrderConfirmationEmail(email: string, order: any): Promise<void> {
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    await this.sendEmail({
      to: email,
      subject: `Order Confirmation - #${orderId} - Honey Store`,
      html: this.templatesService.getOrderConfirmationEmail(order),
    });
  }

  async sendOrderStatusUpdateEmail(email: string, order: any): Promise<void> {
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    await this.sendEmail({
      to: email,
      subject: `Order Update - #${orderId} - Honey Store`,
      html: this.templatesService.getOrderStatusUpdateEmail(order),
    });
  }

  async sendSellerApprovalEmail(email: string, sellerName: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Seller Account Approved - Welcome to Honey Store!',
      html: this.templatesService.getSellerApprovalEmail(sellerName),
    });
  }

  async sendSellerRejectionEmail(email: string, sellerName: string, reason?: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Seller Account Application Status - Honey Store',
      html: this.templatesService.getSellerRejectionEmail(sellerName, reason),
    });
  }
}
