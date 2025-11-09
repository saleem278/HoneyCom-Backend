import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';
import { DeviceSchema } from '../../models/Device.model';
import { NotificationSchema } from '../../models/Notification.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Device', schema: DeviceSchema },
      { name: 'Notification', schema: NotificationSchema },
    ]),
  ],
  controllers: [MobileController],
  providers: [MobileService],
  exports: [MobileService],
})
export class MobileModule {}

