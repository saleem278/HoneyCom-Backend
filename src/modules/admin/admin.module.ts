import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { User, UserSchema } from '../../models/User.model';
import { Product, ProductSchema } from '../../models/Product.model';
import { Order, OrderSchema } from '../../models/Order.model';
import { Category, CategorySchema } from '../../models/Category.model';
import { ImpersonationEventSchema } from '../../models/ImpersonationEvent.model';
import { SettingsSchema } from '../../models/Settings.model';
import { NotificationSchema } from '../../models/Notification.model';
import { BroadcastSchema } from '../../models/Broadcast.model';
import { StoreSchema } from '../../models/Store.model';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { EmailService } from '../../services/email.service';
import { ExchangeRateService } from '../../services/exchange-rate.service';
import { LoyaltyModule } from '../loyalty/loyalty.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Order', schema: OrderSchema },
      { name: 'Category', schema: CategorySchema },
      { name: 'ImpersonationEvent', schema: ImpersonationEventSchema },
      { name: 'Settings', schema: SettingsSchema },
      { name: 'Notification', schema: NotificationSchema },
      { name: 'Broadcast', schema: BroadcastSchema },
      { name: 'Store', schema: StoreSchema },
    ]),
    ScheduleModule.forRoot(),
    ConfigModule,
    AuthModule,
    PaymentsModule,
    UsersModule,
    forwardRef(() => LoyaltyModule),
  ],
  controllers: [AdminController],
  providers: [AdminService, NotificationSchedulerService, EmailService, ExchangeRateService],
  exports: [AdminService],
})
export class AdminModule {}

