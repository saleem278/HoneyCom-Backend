import { Controller, Post, Body, UseGuards, Headers, RawBodyRequest, Req, Inject, forwardRef } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrdersService } from '../orders/orders.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {
    // Inject orders service into payments service to avoid circular dependency
    this.paymentsService.setOrdersService(this.ordersService);
  }

  @Post('create-intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create payment intent' })
  @ApiResponse({ status: 200, description: 'Payment intent created' })
  async createPaymentIntent(@Body() body: { amount: number; currency?: string }) {
    return this.paymentsService.createPaymentIntent(body.amount, body.currency);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Confirm payment' })
  @ApiResponse({ status: 200, description: 'Payment confirmed' })
  async confirmPayment(@Body() body: { paymentId: string }) {
    return this.paymentsService.confirmPayment(body.paymentId);
  }

  @Post('create-setup-intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create setup intent for saving payment methods' })
  @ApiResponse({ status: 200, description: 'Setup intent created' })
  async createSetupIntent(@Body() body?: { customerId?: string }) {
    return this.paymentsService.createSetupIntent(body?.customerId);
  }

  /**
   * Stripe Webhook Endpoint
   * This endpoint receives webhook events from Stripe
   * It should NOT require authentication (Stripe signs the requests)
   * 
   * To configure in Stripe Dashboard:
   * 1. Go to Developers > Webhooks
   * 2. Add endpoint: https://yourdomain.com/api/payments/webhook
   * 3. Select events: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded
   * 4. Copy the webhook signing secret to STRIPE_WEBHOOK_SECRET env variable
   */
  @Post('webhook')
  @ApiOperation({ summary: 'Handle Stripe webhook events (public endpoint)' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    try {
      // Get raw body for signature verification
      // NestJS with rawBody: true provides rawBody as Buffer
      const payload = (req as any).rawBody || req.body;
      
      if (!signature) {
        return {
          success: false,
          message: 'Missing stripe-signature header',
        };
      }
      
      // Verify and parse webhook event
      const event = await this.paymentsService.handleWebhook(payload, signature);
      
      // Process the event (this will update order status automatically)
      const result = await this.paymentsService.processWebhookEvent(event);
      
      return result;
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Webhook processing failed',
      };
    }
  }
}

