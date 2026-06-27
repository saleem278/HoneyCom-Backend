import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { DisputeSchema } from '../../models/Dispute.model';
import { OrderSchema } from '../../models/Order.model';
import { UserSchema } from '../../models/User.model';
import { ProductSchema } from '../../models/Product.model';
import { SettingsSchema } from '../../models/Settings.model';
import { NotificationSchema } from '../../models/Notification.model';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersModule } from '../orders/orders.module';
import { EmailService } from '../../services/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Dispute', schema: DisputeSchema },
      { name: 'Order', schema: OrderSchema },
      { name: 'User', schema: UserSchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Settings', schema: SettingsSchema },
      { name: 'Notification', schema: NotificationSchema },
    ]),
    AuthModule,
    PaymentsModule,
    OrdersModule,
  ],
  controllers: [DisputesController],
  providers: [DisputesService, EmailService],
  exports: [DisputesService],
})
export class DisputesModule {}

