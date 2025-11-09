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
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Currency } from '../../common/decorators/currency.decorator';

@ApiTags('Cart')
@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: "Get user's cart" })
  @ApiResponse({ status: 200, description: 'Cart retrieved successfully' })
  async getCart(@Request() req, @Currency() currency: string) {
    return this.cartService.getCart(req.user.id, currency);
  }

  @Post()
  @ApiOperation({ summary: 'Add item to cart' })
  @ApiResponse({ status: 200, description: 'Item added to cart' })
  async addToCart(@Request() req, @Body() body: { productId: string; quantity: number; variant?: string; variants?: any }) {
    // Support both 'variant' (string) and 'variants' (object) for backward compatibility
    const variants = body.variants || (body.variant ? { variant: body.variant } : {});
    return this.cartService.addToCart(req.user.id, body.productId, body.quantity, variants);
  }

  @Put(':itemId')
  @ApiOperation({ summary: 'Update cart item quantity' })
  @ApiResponse({ status: 200, description: 'Cart item updated' })
  async updateCartItem(
    @Request() req,
    @Param('itemId') itemId: string,
    @Body() body: { quantity: number }
  ) {
    return this.cartService.updateCartItem(req.user.id, itemId, body.quantity);
  }

  @Delete(':itemId')
  @ApiOperation({ summary: 'Remove item from cart' })
  @ApiResponse({ status: 200, description: 'Item removed from cart' })
  async removeFromCart(@Request() req, @Param('itemId') itemId: string) {
    return this.cartService.removeFromCart(req.user.id, itemId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear entire cart' })
  @ApiResponse({ status: 200, description: 'Cart cleared' })
  async clearCart(@Request() req) {
    return this.cartService.clearCart(req.user.id);
  }

  @Post('coupon')
  @ApiOperation({ summary: 'Apply coupon code' })
  @ApiResponse({ status: 200, description: 'Coupon applied successfully' })
  @ApiResponse({ status: 400, description: 'Invalid coupon code' })
  async applyCoupon(@Request() req, @Body() body: { code: string }) {
    return this.cartService.applyCoupon(req.user.id, body.code);
  }
}

