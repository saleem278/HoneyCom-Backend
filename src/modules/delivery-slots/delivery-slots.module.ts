import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeliverySlotsController } from './delivery-slots.controller';
import { DeliverySlotsService } from './delivery-slots.service';
import { DeliverySlotSchema } from '../../models/DeliverySlot.model';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'DeliverySlot', schema: DeliverySlotSchema },
    ]),
    AuthModule,
  ],
  controllers: [DeliverySlotsController],
  providers: [DeliverySlotsService],
  exports: [DeliverySlotsService],
})
export class DeliverySlotsModule {}
