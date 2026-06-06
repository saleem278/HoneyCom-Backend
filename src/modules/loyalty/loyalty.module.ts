import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { UserSchema } from '../../models/User.model';
import { LoyaltyTransactionSchema } from '../../models/LoyaltyTransaction.model';
import { SettingsSchema } from '../../models/Settings.model';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'LoyaltyTransaction', schema: LoyaltyTransactionSchema },
      { name: 'Settings', schema: SettingsSchema },
    ]),
    AuthModule,
  ],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
