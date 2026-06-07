import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SellerController } from './seller.controller';
import { SellerService } from './seller.service';
import { Product, ProductSchema } from '../../models/Product.model';
import { Order, OrderSchema } from '../../models/Order.model';
import { User, UserSchema } from '../../models/User.model';
import { SettingsSchema } from '../../models/Settings.model';
import { AuthModule } from '../auth/auth.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { EmailService } from '../../services/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Product', schema: ProductSchema },
      { name: 'Order', schema: OrderSchema },
      { name: 'User', schema: UserSchema },
      { name: 'Settings', schema: SettingsSchema },
    ]),
    AuthModule,
    forwardRef(() => LoyaltyModule),
  ],
  controllers: [SellerController],
  providers: [SellerService, EmailService],
  exports: [SellerService],
})
export class SellerModule {}

