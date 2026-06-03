import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { IWebhookEvent } from '../../models/WebhookEvent.model';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private razorpay: any;
  private razorpayKeyId: string;
  private razorpayKeySecret: string;
  private razorpayWebhookSecret: string;
  private ordersService: any;

  constructor(
    private configService: ConfigService,
    @InjectModel('WebhookEvent') private webhookEventModel: Model<IWebhookEvent>,
  ) {
    this.razorpayKeyId = this.configService.get<string>('RAZORPAY_KEY_ID') || '';
    this.razorpayKeySecret = this.configService.get<string>('RAZORPAY_KEY_SECRET') || '';
    this.razorpayWebhookSecret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET') || '';

    if (this.razorpayKeyId && this.razorpayKeySecret) {
      try {
        const Razorpay = require('razorpay');
        this.razorpay = new Razorpay({
          key_id: this.razorpayKeyId,
          key_secret: this.razorpayKeySecret,
        });
      } catch (error) {
        this.logger.warn('Razorpay not properly configured.');
      }
    }
  }

  // Razorpay-supported currencies
  private static readonly SUPPORTED_CURRENCIES = new Set([
    'INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED', 'MYR', 'SAR',
  ]);

  /**
   * Create a Razorpay order. The frontend uses the returned `id` to open
   * the Razorpay Checkout modal and the `key_id` to authenticate.
   */
  async createOrder(amount: number, currency: string = 'INR') {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const normalizedCurrency = currency.toUpperCase();
    if (!PaymentsService.SUPPORTED_CURRENCIES.has(normalizedCurrency)) {
      throw new BadRequestException(
        `Unsupported currency: ${currency}. Supported: ${[...PaymentsService.SUPPORTED_CURRENCIES].join(', ')}`,
      );
    }

    // Razorpay amounts are in smallest currency unit (paise for INR)
    const amountInSmallestUnit = Math.round(amount * 100);

    if (this.razorpay) {
      try {
        const order = await this.razorpay.orders.create({
          amount: amountInSmallestUnit,
          currency: normalizedCurrency,
          receipt: `rcpt_${Date.now().toString(36)}`,
        });

        return {
          success: true,
          orderId: order.id,
          amount,
          currency: normalizedCurrency,
          keyId: this.razorpayKeyId,
        };
      } catch (error: any) {
        // Razorpay SDK wraps API errors as { statusCode, error: { description } }
        const msg =
          error?.error?.description ||
          error?.message ||
          JSON.stringify(error);
        this.logger.error(`Razorpay order creation failed: ${msg}`);
        throw new BadRequestException(`Razorpay order creation failed: ${msg}`);
      }
    }

    // Placeholder mode (dev only)
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProd) {
      throw new BadRequestException('Payment service is not configured. Please contact support.');
    }

    this.logger.warn('Razorpay not configured — returning placeholder order (non-production only)');
    return {
      success: true,
      orderId: `order_placeholder_${Date.now()}`,
      amount,
      currency: normalizedCurrency,
      keyId: 'rzp_test_placeholder',
      note: 'Razorpay not configured - placeholder mode',
    };
  }

  /**
   * Verify Razorpay payment signature after the client-side checkout
   * completes. Called by the frontend to confirm the payment is authentic
   * before marking the order paid.
   *
   * Razorpay signs: `razorpay_order_id|razorpay_payment_id`
   */
  verifyPaymentSignature(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ): boolean {
    if (!this.razorpayKeySecret) return false;
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = createHmac('sha256', this.razorpayKeySecret)
      .update(body)
      .digest('hex');
    return expectedSignature === razorpaySignature;
  }

  async confirmPayment(razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string) {
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw new BadRequestException('razorpayOrderId, razorpayPaymentId, and razorpaySignature are required');
    }

    if (this.razorpay) {
      const valid = this.verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      if (!valid) {
        throw new BadRequestException('Payment signature verification failed');
      }

      try {
        const payment = await this.razorpay.payments.fetch(razorpayPaymentId);
        if (payment.status !== 'captured' && payment.status !== 'authorized') {
          throw new BadRequestException(`Payment not completed. Status: ${payment.status}`);
        }
        return {
          success: true,
          message: 'Payment confirmed',
          razorpayOrderId,
          razorpayPaymentId,
          amount: payment.amount / 100,
          currency: payment.currency,
        };
      } catch (error: any) {
        const msg = error?.error?.description || error?.message || JSON.stringify(error);
        throw new BadRequestException(`Payment confirmation failed: ${msg}`);
      }
    }

    // Placeholder mode
    return {
      success: true,
      message: 'Payment confirmed (placeholder mode)',
      razorpayOrderId,
      razorpayPaymentId,
    };
  }

  async processRefund(razorpayPaymentId: string, amount?: number, reason?: string) {
    if (!razorpayPaymentId) {
      throw new BadRequestException('Razorpay payment ID is required');
    }

    if (this.razorpay) {
      try {
        const refundParams: any = {};
        if (amount) {
          refundParams.amount = Math.round(amount * 100);
        }
        if (reason) {
          refundParams.notes = { reason };
        }

        const refund = await this.razorpay.payments.refund(razorpayPaymentId, refundParams);

        return {
          success: true,
          refundId: refund.id,
          amount: refund.amount / 100,
          status: refund.status,
          razorpayPaymentId,
        };
      } catch (error: any) {
        const msg = error?.error?.description || error?.message || JSON.stringify(error);
        throw new BadRequestException(`Refund processing failed: ${msg}`);
      }
    }

    // Placeholder mode
    return {
      success: true,
      message: 'Refund processed (placeholder mode)',
      razorpayPaymentId,
      amount,
    };
  }

  /**
   * Verify Razorpay webhook signature using HMAC SHA256 with the
   * webhook secret. Returns the parsed event body on success.
   */
  handleWebhook(payload: Buffer, signature: string): any {
    if (!this.razorpayWebhookSecret) {
      // No webhook secret configured — accept in non-prod for ease of dev
      const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
      if (isProd) {
        throw new BadRequestException('Razorpay webhook secret not configured');
      }
      return JSON.parse(payload.toString());
    }

    const expectedSignature = createHmac('sha256', this.razorpayWebhookSecret)
      .update(payload)
      .digest('hex');

    if (expectedSignature !== signature) {
      throw new BadRequestException('Razorpay webhook signature verification failed');
    }

    return JSON.parse(payload.toString());
  }

  setOrdersService(ordersService: any) {
    this.ordersService = ordersService;
  }

  async processWebhookEvent(event: any): Promise<{ success: boolean; message: string }> {
    // Idempotency guard — same event ID can arrive multiple times on retry
    try {
      await this.webhookEventModel.create({
        eventId: event.id || `${event.event}_${Date.now()}`,
        eventType: event.event,
        processedAt: new Date(),
      });
    } catch (dupErr: any) {
      if (dupErr?.code === 11000) {
        this.logger.log(`Razorpay webhook ${event.id} (${event.event}) already processed — skipping`);
        return { success: true, message: 'Event already processed (idempotent skip)' };
      }
      throw dupErr;
    }

    try {
      const eventType: string = event.event || '';
      const payload = event.payload?.payment?.entity || event.payload?.refund?.entity;

      switch (eventType) {
        case 'payment.authorized':
        case 'payment.captured': {
          const paymentId = payload?.id;
          const orderId = payload?.order_id;
          this.logger.log(`Payment ${eventType}: paymentId=${paymentId} orderId=${orderId}`);
          if (this.ordersService && orderId) {
            try {
              await this.ordersService.updatePaymentStatusByRazorpayOrderId(
                orderId,
                paymentId,
                'paid',
                'processing',
              );
            } catch (err: any) {
              this.logger.warn(`Failed to update order for Razorpay order ${orderId}: ${err.message}`);
            }
          }
          return { success: true, message: 'Payment confirmed' };
        }

        case 'payment.failed': {
          const orderId = payload?.order_id;
          this.logger.warn(`Payment failed: orderId=${orderId}`);
          if (this.ordersService && orderId) {
            try {
              await this.ordersService.updatePaymentStatusByRazorpayOrderId(orderId, null, 'failed');
            } catch (err: any) {
              this.logger.warn(`Failed to update order: ${err.message}`);
            }
          }
          return { success: true, message: 'Payment failed recorded' };
        }

        case 'refund.created':
        case 'refund.processed': {
          const paymentId = payload?.payment_id;
          this.logger.log(`Refund processed for payment ${paymentId}`);
          return { success: true, message: 'Refund recorded' };
        }

        default:
          this.logger.log(`Unhandled Razorpay event: ${eventType}`);
          return { success: true, message: 'Event received but not processed' };
      }
    } catch (error: any) {
      this.logger.error(`Error processing webhook event: ${error.message}`);
      throw new BadRequestException(`Webhook processing failed: ${error.message}`);
    }
  }
}
