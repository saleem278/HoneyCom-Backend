import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from '../../models/User.model';
import { Address, AddressSchema } from '../../models/Address.model';
import { PaymentMethod, PaymentMethodSchema } from '../../models/PaymentMethod.model';
import { Product, ProductSchema } from '../../models/Product.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      { name: 'Address', schema: AddressSchema },
      { name: 'PaymentMethod', schema: PaymentMethodSchema },
      { name: 'Product', schema: ProductSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

