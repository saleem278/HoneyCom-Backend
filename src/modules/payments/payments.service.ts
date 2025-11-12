import { Injectable, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private stripeSecretKey: string;
  private stripeWebhookSecret: string;
  private stripe: any;
  private ordersService: any; // Will be injected via setter to avoid circular dependency

  constructor(private configService: ConfigService) {
    // Initialize Stripe if secret key is available
    this.stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY') || '';
    this.stripeWebhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || '';
    
    // Only initialize Stripe if key is provided
    if (this.stripeSecretKey && this.stripeSecretKey !== '') {
      try {
        // Dynamic import for Stripe
        const Stripe = require('stripe');
        this.stripe = new Stripe(this.stripeSecretKey, {
          apiVersion: '2024-11-20.acacia',
        });
      } catch (error) {
        // Stripe not installed or key not configured. Using placeholder mode.
        this.logger.warn('Stripe not properly configured. Using placeholder mode.');
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

  async createSetupIntent(customerId?: string) {
    // If Stripe is configured, create setup intent
    if (this.stripe && this.stripeSecretKey) {
      try {
        const setupIntentParams: any = {
          payment_method_types: ['card'],
        };

        if (customerId) {
          setupIntentParams.customer = customerId;
        }

        const setupIntent = await this.stripe.setupIntents.create(setupIntentParams);

        return {
          success: true,
          clientSecret: setupIntent.client_secret,
          setupIntentId: setupIntent.id,
        };
      } catch (error: any) {
        throw new BadRequestException(`Setup intent creation failed: ${error.message}`);
      }
    }

    // Placeholder mode
    return {
      success: true,
      clientSecret: `seti_placeholder_${Date.now()}_secret_placeholder`,
      setupIntentId: `seti_placeholder_${Date.now()}`,
      note: 'Stripe not configured - using placeholder mode',
    };
  }

  /**
   * Verify and handle Stripe webhook events
   * @param payload Raw webhook payload
   * @param signature Webhook signature from Stripe
   * @returns Parsed event object
   */
  async handleWebhook(payload: string | Buffer, signature: string): Promise<any> {
    if (!this.stripe || !this.stripeWebhookSecret) {
      throw new BadRequestException('Stripe webhook not configured');
    }

    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.stripeWebhookSecret
      );

      this.logger.log(`Received webhook event: ${event.type}`);

      return event;
    } catch (error: any) {
      this.logger.error(`Webhook signature verification failed: ${error.message}`);
      throw new BadRequestException(`Webhook Error: ${error.message}`);
    }
  }

  /**
   * Set orders service (injected to avoid circular dependency)
   */
  setOrdersService(ordersService: any) {
    this.ordersService = ordersService;
  }

  /**
   * Process webhook event and update order status
   * This should be called after handleWebhook to process the event
   */
  async processWebhookEvent(event: any): Promise<{ success: boolean; message: string }> {
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          // Payment was successful
          const paymentIntent = event.data.object;
          this.logger.log(`Payment succeeded: ${paymentIntent.id}`);
          
          // Update order status if orders service is available
          if (this.ordersService) {
            try {
              await this.ordersService.updatePaymentStatusByIntentId(
                paymentIntent.id,
                'paid',
                'processing'
              );
              this.logger.log(`Order updated for payment intent: ${paymentIntent.id}`);
            } catch (error: any) {
              this.logger.warn(`Failed to update order: ${error.message}`);
            }
          }
          
          return { success: true, message: 'Payment confirmed' };

        case 'payment_intent.payment_failed':
          // Payment failed
          const failedPayment = event.data.object;
          this.logger.warn(`Payment failed: ${failedPayment.id}`);
          
          // Update order status if orders service is available
          if (this.ordersService) {
            try {
              await this.ordersService.updatePaymentStatusByIntentId(
                failedPayment.id,
                'failed'
              );
            } catch (error: any) {
              this.logger.warn(`Failed to update order: ${error.message}`);
            }
          }
          
          return { success: true, message: 'Payment failed' };

        case 'charge.refunded':
          // Refund was processed
          const refund = event.data.object;
          this.logger.log(`Refund processed: ${refund.id}`);
          
          // Update order status if orders service is available
          if (this.ordersService && refund.payment_intent) {
            try {
              await this.ordersService.updatePaymentStatusByIntentId(
                refund.payment_intent,
                'refunded',
                'refunded'
              );
            } catch (error: any) {
              this.logger.warn(`Failed to update order: ${error.message}`);
            }
          }
          
          return { success: true, message: 'Refund processed' };

        case 'payment_method.attached':
          // Payment method was attached to customer
          this.logger.log('Payment method attached');
          return { success: true, message: 'Payment method attached' };

        default:
          this.logger.log(`Unhandled event type: ${event.type}`);
          return { success: true, message: 'Event received but not processed' };
      }
    } catch (error: any) {
      this.logger.error(`Error processing webhook event: ${error.message}`);
      throw new BadRequestException(`Webhook processing failed: ${error.message}`);
    }
  }
}

