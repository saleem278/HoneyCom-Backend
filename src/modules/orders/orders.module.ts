import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order, OrderSchema } from '../../models/Order.model';
import { Cart, CartSchema } from '../../models/Cart.model';
import { Product, ProductSchema } from '../../models/Product.model';
import { Address, AddressSchema } from '../../models/Address.model';
import { Coupon, CouponSchema } from '../../models/Coupon.model';
import { Settings, SettingsSchema } from '../../models/Settings.model';
import { UserSchema } from '../../models/User.model';
import { FlashSaleSchema } from '../../models/FlashSale.model';
import { DeliverySlotSchema } from '../../models/DeliverySlot.model';
import { LoyaltyTransactionSchema } from '../../models/LoyaltyTransaction.model';
import { IdempotencyKeySchema } from '../../models/IdempotencyKey.model';
import { NotificationSchema } from '../../models/Notification.model';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from '../../services/email.service';
import { PdfService } from '../../services/pdf.service';
import { ExchangeRateService } from '../../services/exchange-rate.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Order', schema: OrderSchema },
      { name: 'Cart', schema: CartSchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Address', schema: AddressSchema },
      { name: 'Coupon', schema: CouponSchema },
      { name: 'Settings', schema: SettingsSchema },
      { name: 'User', schema: UserSchema },
      { name: 'FlashSale', schema: FlashSaleSchema },
      { name: 'DeliverySlot', schema: DeliverySlotSchema },
      { name: 'LoyaltyTransaction', schema: LoyaltyTransactionSchema },
      { name: 'IdempotencyKey', schema: IdempotencyKeySchema },
      { name: 'Notification', schema: NotificationSchema },
    ]),
    AuthModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [OrdersController],
  providers: [OrdersService, EmailService, PdfService, ExchangeRateService],
  exports: [OrdersService],
})
export class OrdersModule {}

