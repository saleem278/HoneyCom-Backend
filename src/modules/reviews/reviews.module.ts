import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { Review, ReviewSchema } from '../../models/Review.model';
import { Product, ProductSchema } from '../../models/Product.model';
import { Order, OrderSchema } from '../../models/Order.model';
import { SettingsSchema } from '../../models/Settings.model';
import { NotificationSchema } from '../../models/Notification.model';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from '../../services/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Review', schema: ReviewSchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Order', schema: OrderSchema },
      { name: 'Settings', schema: SettingsSchema },
      { name: 'Notification', schema: NotificationSchema },
    ]),
    AuthModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService, EmailService],
  exports: [ReviewsService],
})
export class ReviewsModule {}

