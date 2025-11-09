import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private twilioAccountSid: string;
  private twilioAuthToken: string;
  private twilioPhoneNumber: string;
  private twilioClient: any;

  constructor(private configService: ConfigService) {
    this.twilioAccountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID') || '';
    this.twilioAuthToken = this.configService.get<string>('TWILIO_AUTH_TOKEN') || '';
    this.twilioPhoneNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER') || '';

    // Initialize Twilio if credentials are available
    if (this.twilioAccountSid && this.twilioAuthToken) {
      try {
        // Dynamic import for Twilio
        // const twilio = require('twilio');
        // this.twilioClient = twilio(this.twilioAccountSid, this.twilioAuthToken);
      } catch (error) {
        // Twilio not installed or not configured. Using placeholder mode.
      }
    }
  }

  async sendSms(to: string, message: string): Promise<void> {
    if (!to || !message) {
      throw new Error('Phone number and message are required');
    }

    // If Twilio is configured, use it
    if (this.twilioClient && this.twilioPhoneNumber) {
      try {
        await this.twilioClient.messages.create({
          body: message,
          from: this.twilioPhoneNumber,
          to: to,
        });
        // SMS sent
      } catch (error: any) {
        // Error sending SMS
        throw new Error(`Failed to send SMS: ${error.message}`);
      }
    } else {
      // Placeholder mode (for development/testing)
      // SMS Placeholder
    }
  }

  async sendOTP(phoneNumber: string, otp: string): Promise<void> {
    const message = `Your verification code is: ${otp}. This code will expire in 10 minutes.`;
    await this.sendSms(phoneNumber, message);
  }

  async sendOrderConfirmation(phoneNumber: string, orderNumber: string): Promise<void> {
    const message = `Your order #${orderNumber} has been confirmed! We'll notify you when it ships.`;
    await this.sendSms(phoneNumber, message);
  }

  async sendOrderShipped(phoneNumber: string, orderNumber: string, trackingNumber?: string): Promise<void> {
    let message = `Your order #${orderNumber} has been shipped!`;
    if (trackingNumber) {
      message += ` Track your order: ${trackingNumber}`;
    }
    await this.sendSms(phoneNumber, message);
  }
}

