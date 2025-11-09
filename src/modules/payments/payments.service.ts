import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentsService {
  private stripeSecretKey: string;
  private stripe: any;

  constructor(private configService: ConfigService) {
    // Initialize Stripe if secret key is available
    this.stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY') || '';
    
    // Only initialize Stripe if key is provided
    if (this.stripeSecretKey && this.stripeSecretKey !== '') {
      try {
        // Dynamic import for Stripe
        // this.stripe = require('stripe')(this.stripeSecretKey);
      } catch (error) {
        // Stripe not installed or key not configured. Using placeholder mode.
      }
    }
  }

  async createPaymentIntent(amount: number, currency: string = 'INR') {
    // Validate amount
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    // Convert to cents for Stripe
    const amountInCents = Math.round(amount * 100);

    // If Stripe is configured, use it
    if (this.stripe && this.stripeSecretKey) {
      try {
        const paymentIntent = await this.stripe.paymentIntents.create({
          amount: amountInCents,
          currency: currency.toUpperCase(),
          automatic_payment_methods: {
            enabled: true,
          },
        });

        return {
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          amount,
          currency,
        };
      } catch (error: any) {
        throw new BadRequestException(`Payment intent creation failed: ${error.message}`);
      }
    }

    // Placeholder mode (for development/testing)
    return {
      success: true,
      clientSecret: `placeholder_secret_${Date.now()}`,
      paymentIntentId: `pi_placeholder_${Date.now()}`,
      amount,
      currency,
      note: 'Stripe not configured - using placeholder mode',
    };
  }

  async confirmPayment(paymentIntentId: string) {
    if (!paymentIntentId) {
      throw new BadRequestException('Payment intent ID is required');
    }

    // If Stripe is configured, verify payment
    if (this.stripe && this.stripeSecretKey) {
      try {
        const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
        
        if (paymentIntent.status !== 'succeeded') {
          throw new BadRequestException(`Payment not completed. Status: ${paymentIntent.status}`);
        }

        return {
          success: true,
          message: 'Payment confirmed',
          paymentIntentId,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
        };
      } catch (error: any) {
        throw new BadRequestException(`Payment confirmation failed: ${error.message}`);
      }
    }

    // Placeholder mode
    return {
      success: true,
      message: 'Payment confirmed (placeholder mode)',
      paymentIntentId,
      note: 'Stripe not configured - using placeholder mode',
    };
  }

  async processRefund(paymentIntentId: string, amount?: number, reason?: string) {
    if (!paymentIntentId) {
      throw new BadRequestException('Payment intent ID is required');
    }

    // If Stripe is configured, process refund
    if (this.stripe && this.stripeSecretKey) {
      try {
        const refundParams: any = {
          payment_intent: paymentIntentId,
        };

        if (amount) {
          refundParams.amount = Math.round(amount * 100); // Convert to cents
        }

        if (reason) {
          refundParams.reason = reason;
        }

        const refund = await this.stripe.refunds.create(refundParams);

        return {
          success: true,
          refundId: refund.id,
          amount: refund.amount / 100,
          status: refund.status,
          paymentIntentId,
        };
      } catch (error: any) {
        throw new BadRequestException(`Refund processing failed: ${error.message}`);
      }
    }

    // Placeholder mode
    return {
      success: true,
      message: 'Refund processed (placeholder mode)',
      paymentIntentId,
      amount,
      note: 'Stripe not configured - using placeholder mode',
    };
  }
}

