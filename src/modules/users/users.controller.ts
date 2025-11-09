import {
  Controller,
  Get,
  Put,
  Post,
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
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Users')
@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  async getProfile(@Request() req) {
    return this.usersService.getProfile(req.user.id);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  async updateProfile(@Request() req, @Body() updateData: any) {
    return this.usersService.updateProfile(req.user.id, updateData);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get user addresses' })
  @ApiResponse({ status: 200, description: 'List of addresses' })
  async getAddresses(@Request() req) {
    return this.usersService.getAddresses(req.user.id);
  }

  @Post('addresses')
  @ApiOperation({ summary: 'Add new address' })
  @ApiResponse({ status: 201, description: 'Address added successfully' })
  async addAddress(@Request() req, @Body() addressData: any) {
    return this.usersService.addAddress(req.user.id, addressData);
  }

  @Put('addresses/:id')
  @ApiOperation({ summary: 'Update address' })
  @ApiResponse({ status: 200, description: 'Address updated successfully' })
  async updateAddress(
    @Request() req,
    @Param('id') addressId: string,
    @Body() updateData: any
  ) {
    return this.usersService.updateAddress(req.user.id, addressId, updateData);
  }

  @Delete('addresses/:id')
  @ApiOperation({ summary: 'Delete address' })
  @ApiResponse({ status: 200, description: 'Address deleted successfully' })
  async deleteAddress(@Request() req, @Param('id') addressId: string) {
    return this.usersService.deleteAddress(req.user.id, addressId);
  }

  @Get('payment-methods')
  @ApiOperation({ summary: 'Get user payment methods' })
  @ApiResponse({ status: 200, description: 'List of payment methods' })
  async getPaymentMethods(@Request() req) {
    return this.usersService.getPaymentMethods(req.user.id);
  }

  @Post('payment-methods')
  @ApiOperation({ 
    summary: 'Add payment method',
    description: 'Adds a payment method using Stripe payment method token. Card data should be tokenized via Stripe Elements before calling this endpoint.'
  })
  @ApiResponse({ status: 201, description: 'Payment method added successfully' })
  async addPaymentMethod(@Request() req, @Body() paymentData: {
    type: 'card' | 'paypal';
    stripePaymentMethodId?: string; // Required for card type
    last4?: string;
    brand?: string;
    cardHolderName?: string;
    expiryMonth?: string;
    expiryYear?: string;
    paypalEmail?: string; // Required for PayPal type
    isDefault?: boolean;
  }) {
    return this.usersService.addPaymentMethod(req.user.id, paymentData);
  }

  @Put('payment-methods/:id')
  @ApiOperation({ summary: 'Update payment method' })
  @ApiResponse({ status: 200, description: 'Payment method updated successfully' })
  async updatePaymentMethod(
    @Request() req,
    @Param('id') paymentMethodId: string,
    @Body() updateData: { cardHolderName?: string; isDefault?: boolean }
  ) {
    return this.usersService.updatePaymentMethod(req.user.id, paymentMethodId, updateData);
  }

  @Delete('payment-methods/:id')
  @ApiOperation({ summary: 'Delete payment method' })
  @ApiResponse({ status: 200, description: 'Payment method deleted successfully' })
  async deletePaymentMethod(@Request() req, @Param('id') paymentMethodId: string) {
    return this.usersService.deletePaymentMethod(req.user.id, paymentMethodId);
  }

  @Get('wishlist')
  @ApiOperation({ summary: 'Get user wishlist' })
  @ApiResponse({ status: 200, description: 'User wishlist' })
  async getWishlist(@Request() req) {
    return this.usersService.getWishlist(req.user.id);
  }

  @Post('wishlist')
  @ApiOperation({ summary: 'Add product to wishlist' })
  @ApiResponse({ status: 200, description: 'Product added to wishlist' })
  async addToWishlist(@Request() req, @Body() body: { productId: string }) {
    return this.usersService.addToWishlist(req.user.id, body.productId);
  }

  @Delete('wishlist/:productId')
  @ApiOperation({ summary: 'Remove product from wishlist' })
  @ApiResponse({ status: 200, description: 'Product removed from wishlist' })
  async removeFromWishlist(@Request() req, @Param('productId') productId: string) {
    return this.usersService.removeFromWishlist(req.user.id, productId);
  }

  @Delete('wishlist')
  @ApiOperation({ summary: 'Clear wishlist' })
  @ApiResponse({ status: 200, description: 'Wishlist cleared' })
  async clearWishlist(@Request() req) {
    return this.usersService.clearWishlist(req.user.id);
  }
}

