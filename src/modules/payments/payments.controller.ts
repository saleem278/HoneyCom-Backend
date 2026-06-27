import {
  Controller,
  Post,
  Body,
  UseGuards,
  Headers,
  RawBodyRequest,
  Req,
  Res,
  Request,
  Inject,
  forwardRef,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrdersService } from '../orders/orders.service';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
  ) {
    this.paymentsService.setOrdersService(this.ordersService);
  }

  /**
   * Create a Razorpay order. The frontend passes the returned `orderId`
   * and `keyId` to the Razorpay Checkout modal.
   *
   * SERVER-AUTHORITATIVE: the Razorpay amount is derived from the persisted
   * Order.total (looked up by the internal `orderId`), never from a
   * client-supplied amount. This guarantees the gateway charges exactly what
   * the server computed for the order — closing the under/over-charge gap where
   * the client could send any cart total. After creating the gateway order we
   * stamp `razorpayOrderId` back onto the Order so the webhook can match it.
   *
   * A legacy `amount`-only call is still accepted (mobile / older clients) but
   * is decoupled from any order; web checkout must pass `orderId`.
   */
  @Post('create-order')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create Razorpay order' })
  @ApiResponse({ status: 201, description: 'Razorpay order created' })
  async createOrder(
    @Request() req: AuthedRequest,
    @Body() body: { orderId?: string; amount?: number; currency?: string },
  ) {
    if (body.orderId) {
      // Server-authoritative path: derive the amount + currency from the
      // persisted order, create the gateway order, then link it back.
      const { amount, currency } = await this.ordersService.getRazorpayAmountForOrder(
        body.orderId,
        req.user.id,
      );
      const result = await this.paymentsService.createOrder(amount, currency);
      await this.ordersService.attachRazorpayOrderId(body.orderId, req.user.id, result.orderId);
      return result;
    }

    // Legacy amount-only path (kept for backward compatibility).
    if (typeof body.amount !== 'number') {
      throw new BadRequestException('Either orderId or amount is required');
    }
    return this.paymentsService.createOrder(body.amount, body.currency);
  }

  /**
   * Verify payment after the Razorpay Checkout modal closes successfully.
   * The frontend sends the three IDs returned by Razorpay to confirm the
   * payment is authentic before marking the order paid.
   */
  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify Razorpay payment signature' })
  @ApiResponse({ status: 200, description: 'Payment verified' })
  async verifyPayment(
    @Body() body: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    return this.paymentsService.confirmPayment(
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature,
    );
  }

  /**
   * Razorpay Webhook Endpoint — no auth, Razorpay signs the request.
   *
   * To configure in Razorpay Dashboard:
   * 1. Settings → Webhooks → Add new webhook
   * 2. URL: https://yourdomain.com/api/payments/webhook
   * 3. Secret: set RAZORPAY_WEBHOOK_SECRET in backend .env
   * 4. Events: payment.authorized, payment.captured, payment.failed, refund.created
   */
  @Post('webhook')
  @Throttle({ default: { limit: 100, ttl: 60000 } })
  @ApiOperation({ summary: 'Handle Razorpay webhook events (public endpoint)' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(
    @Req() req: RawBodyRequest<ExpressRequest>,
    @Res({ passthrough: false }) res: Response,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      res.status(500).json({
        success: false,
        message: 'Server misconfigured: rawBody is required for webhook verification',
      });
      return;
    }

    try {
      const event = this.paymentsService.handleWebhook(rawBody, signature);
      const result = await this.paymentsService.processWebhookEvent(event);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(400).json({
        success: false,
        message: error.message || 'Webhook processing failed',
      });
    }
  }
}
