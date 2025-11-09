import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order, OrderSchema } from '../../models/Order.model';
import { Cart, CartSchema } from '../../models/Cart.model';
import { Product, ProductSchema } from '../../models/Product.model';
import { Address, AddressSchema } from '../../models/Address.model';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from '../../services/email.service';
import { PdfService } from '../../services/pdf.service';
import { ExchangeRateService } from '../../services/exchange-rate.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Order', schema: OrderSchema },
      { name: 'Cart', schema: CartSchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Address', schema: AddressSchema },
    ]),
    AuthModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, EmailService, PdfService, ExchangeRateService],
  exports: [OrdersService],
})
export class OrdersModule {}

