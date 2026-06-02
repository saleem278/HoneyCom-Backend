import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Currency } from '../../common/decorators/currency.decorator';
import type { AuthedRequest } from '../../common/types/request.types';

@ApiTags('Cart')
@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: "Get user's cart" })
  @ApiResponse({ status: 200, description: 'Cart retrieved successfully' })
  async getCart(@Request() req: AuthedRequest, @Currency() currency: string) {
    return this.cartService.getCart(req.user.id, currency);
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiResponse({ status: 200, description: 'Item added to cart' })
  async addToCart(
    @Request() req: AuthedRequest,
    @Body() body: { productId: string; quantity: number; variant?: string; variants?: any },
    @Currency() currency: string,
  ) {
    // Support both 'variant' (string) and 'variants' (object) for backward compatibility
    const variants = body.variants || (body.variant ? { variant: body.variant } : {});
    return this.cartService.addToCart(req.user.id, body.productId, body.quantity, variants, currency);
  }

  @Put(':itemId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiResponse({ status: 200, description: 'Cart item updated' })
  async updateCartItem(
    @Request() req: AuthedRequest,
    @Param('itemId') itemId: string,
    @Body() body: { quantity: number },
    @Currency() currency: string,
  ) {
    return this.cartService.updateCartItem(req.user.id, itemId, body.quantity, currency);
  }

  @Delete(':itemId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Remove item from cart' })
  @ApiResponse({ status: 200, description: 'Item removed from cart' })
  async removeFromCart(
    @Request() req: AuthedRequest,
    @Param('itemId') itemId: string,
    @Currency() currency: string,
  ) {
    return this.cartService.removeFromCart(req.user.id, itemId, currency);
  }

  @Delete()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Clear entire cart' })
  @ApiResponse({ status: 200, description: 'Cart cleared' })
  async clearCart(@Request() req: AuthedRequest) {
    return this.cartService.clearCart(req.user.id);
  }

  @Post('coupon')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Apply coupon code' })
  @ApiResponse({ status: 200, description: 'Coupon applied successfully' })
  @ApiResponse({ status: 400, description: 'Invalid coupon code' })
  async applyCoupon(
    @Request() req: AuthedRequest,
    @Body() body: { code: string },
    @Currency() currency: string,
  ) {
    return this.cartService.applyCoupon(req.user.id, body.code, currency);
  }
}
