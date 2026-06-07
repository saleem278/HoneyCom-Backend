import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { UserSchema } from '../../models/User.model';
import { CartSchema } from '../../models/Cart.model';
import { SettingsSchema } from '../../models/Settings.model';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'Cart', schema: CartSchema },
      { name: 'Settings', schema: SettingsSchema },
    ]),
    AuthModule,
  ],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
