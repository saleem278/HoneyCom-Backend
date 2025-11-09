import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: configService.get<string>('SMTP_HOST') || 'smtp.gmail.com',
      port: parseInt(configService.get<string>('SMTP_PORT') || '587'),
      secure: false,
      auth: {
        user: configService.get<string>('SMTP_USER'),
        pass: configService.get<string>('SMTP_PASSWORD'),
      },
    });
  }

  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM') || this.configService.get<string>('SMTP_USER'),
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
    } catch (error) {
      // Error sending email
      throw error;
    }
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const verificationUrl = `${this.configService.get<string>('FRONTEND_URL')}/verify-email?token=${token}`;
    await this.sendEmail({
      to: email,
      subject: 'Verify Your Email Address',
      html: `
        <h1>Welcome to Honey Store!</h1>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verificationUrl}">Verify Email</a>
        <p>If you didn't create an account, please ignore this email.</p>
      `,
    });
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const resetUrl = `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`;
    await this.sendEmail({
      to: email,
      subject: 'Reset Your Password',
      html: `
        <h1>Password Reset Request</h1>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `,
    });
  }

  async sendOrderConfirmationEmail(email: string, order: any): Promise<void> {
    // Use orderNumber if available, otherwise use last 8 chars of _id
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    
    await this.sendEmail({
      to: email,
      subject: `Order Confirmation - #${orderId}`,
      html: `
        <h1>Thank You for Your Order!</h1>
        <p>Your order #${orderId} has been confirmed.</p>
        <h2>Order Summary</h2>
        <p>Total: $${order.total?.toFixed(2) || '0.00'}</p>
        <p>We'll send you another email when your order ships.</p>
      `,
    });
  }

  async sendOrderStatusUpdateEmail(email: string, order: any): Promise<void> {
    // Use orderNumber if available, otherwise use last 8 chars of _id
    const orderId = order.orderNumber || (order._id ? order._id.toString().slice(-8) : 'N/A');
    
    await this.sendEmail({
      to: email,
      subject: `Order Update - #${orderId}`,
      html: `
        <h1>Order Status Updated</h1>
        <p>Your order #${orderId} status has been updated to: ${order.status}</p>
        ${order.trackingNumber ? `<p>Tracking Number: ${order.trackingNumber}</p>` : ''}
      `,
    });
  }

  async sendSellerApprovalEmail(email: string, sellerName: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Seller Account Approved - Welcome to Honey Store!',
      html: `
        <h1>Congratulations, ${sellerName}!</h1>
        <p>Your seller account has been approved. You can now start listing products on Honey Store.</p>
        <p><a href="${this.configService.get<string>('FRONTEND_URL')}/seller">Access Your Seller Dashboard</a></p>
        <p>If you have any questions, please contact our support team.</p>
      `,
    });
  }

  async sendSellerRejectionEmail(email: string, sellerName: string, reason?: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Seller Account Application Status',
      html: `
        <h1>Seller Account Application</h1>
        <p>Dear ${sellerName},</p>
        <p>We regret to inform you that your seller account application has not been approved at this time.</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p>If you believe this is an error or would like to reapply with additional information, please contact our support team.</p>
        <p>Thank you for your interest in selling on Honey Store.</p>
      `,
    });
  }
}
