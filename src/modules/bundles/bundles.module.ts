import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BundlesController } from './bundles.controller';
import { BundlesService } from './bundles.service';
import { BundleSchema } from '../../models/Bundle.model';
import { ProductSchema } from '../../models/Product.model';
import { CartSchema } from '../../models/Cart.model';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Bundle', schema: BundleSchema },
      { name: 'Product', schema: ProductSchema },
      { name: 'Cart', schema: CartSchema },
    ]),
    AuthModule,
  ],
  controllers: [BundlesController],
  providers: [BundlesService],
  exports: [BundlesService],
})
export class BundlesModule {}
