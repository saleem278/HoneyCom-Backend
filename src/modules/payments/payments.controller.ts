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
    this.paymentsService.setOrdersService(this.ordersService);
  }

  /**
   * Create a Razorpay order. The frontend passes the returned `orderId`
   * and `keyId` to the Razorpay Checkout modal.
   */
  @Post('create-order')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create Razorpay order' })
  @ApiResponse({ status: 200, description: 'Razorpay order created' })
  async createOrder(@Body() body: { amount: number; currency?: string }) {
    return this.paymentsService.createOrder(body.amount, body.currency);
  }

  /**
   * Verify payment after the Razorpay Checkout modal closes successfully.
   * The frontend sends the three IDs returned by Razorpay to confirm the
   * payment is authentic before marking the order paid.
   */
  @Post('verify')
  @UseGuards(JwtAuthGuard)
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
  @ApiOperation({ summary: 'Handle Razorpay webhook events (public endpoint)' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
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
