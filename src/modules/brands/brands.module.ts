import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { BrandSchema } from '../../models/Brand.model';
import { ProductSchema } from '../../models/Product.model';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Brand', schema: BrandSchema },
      // Needed so brand deletion can clear dangling brand refs on products.
      { name: 'Product', schema: ProductSchema },
    ]),
    AuthModule,
  ],
  controllers: [BrandsController],
  providers: [BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}

