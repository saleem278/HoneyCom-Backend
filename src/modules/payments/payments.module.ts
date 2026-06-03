import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { OrdersModule } from '../orders/orders.module';
import { WebhookEventSchema } from '../../models/WebhookEvent.model';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => OrdersModule),
    MongooseModule.forFeature([{ name: 'WebhookEvent', schema: WebhookEventSchema }]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

