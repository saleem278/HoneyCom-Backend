import {
  Controller,
  Post,
  Body,
  UseGuards,
  Headers,
  RawBodyRequest,
  Req,
  Res,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
    @Res({ passthrough: false }) res: Response,
    @Headers('stripe-signature') signature: string,
  ) {
    // Stripe signs the *raw bytes* of the body. If rawBody is unavailable
    // (e.g. someone disabled rawBody on the Nest factory), signature
    // verification will silently pass against the parsed JSON because the
    // bytes differ. Fail fast instead.
    const rawBody = req.rawBody;
    if (!rawBody) {
      res.status(500).json({
        success: false,
        message: 'Server misconfigured: rawBody is required for Stripe webhook verification',
      });
      return;
    }

    if (!signature) {
      // 4xx so Stripe knows we didn't process — the dashboard surfaces these.
      res.status(400).json({
        success: false,
        message: 'Missing stripe-signature header',
      });
      return;
    }

    try {
      const event = await this.paymentsService.handleWebhook(rawBody, signature);
      const result = await this.paymentsService.processWebhookEvent(event);
      res.status(200).json(result);
    } catch (error: any) {
      // Verification or processing failure — return 4xx so Stripe retries.
      // Previously this returned 200 with `{ success: false }`, which Stripe
      // treats as a successful delivery and never retries.
      res.status(400).json({
        success: false,
        message: error.message || 'Webhook processing failed',
      });
    }
  }
}

