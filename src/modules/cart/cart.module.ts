import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { Cart, CartSchema } from '../../models/Cart.model';
import { Product, ProductSchema } from '../../models/Product.model';
import { Coupon, CouponSchema } from '../../models/Coupon.model';
import { AuthModule } from '../auth/auth.module';
import { ExchangeRateService } from '../../services/exchange-rate.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Cart', schema: CartSchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Coupon', schema: CouponSchema },
    ]),
    AuthModule,
  ],
  controllers: [CartController],
  providers: [CartService, ExchangeRateService],
  exports: [CartService],
})
export class CartModule {}

