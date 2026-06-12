import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PayoutSchema } from '../../models/Payout.model';
import { ProductSchema } from '../../models/Product.model';
import { OrderSchema } from '../../models/Order.model';
import { UserSchema } from '../../models/User.model';
import { NotificationSchema } from '../../models/Notification.model';
import { SettingsSchema } from '../../models/Settings.model';
import { EmailService } from '../../services/email.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Payout', schema: PayoutSchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Order', schema: OrderSchema },
      { name: 'User', schema: UserSchema },
      // PAY-02: create notifications on payout state transitions
      { name: 'Notification', schema: NotificationSchema },
      // required by EmailService
      { name: 'Settings', schema: SettingsSchema },
    ]),
    ConfigModule,
    AuthModule,
  ],
  controllers: [PayoutsController],
  providers: [PayoutsService, EmailService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
