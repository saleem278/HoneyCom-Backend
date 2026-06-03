import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FlashSalesService } from './flash-sales.service';
import { FlashSalesController } from './flash-sales.controller';
import { FlashSaleSchema } from '../../models/FlashSale.model';
import { ProductSchema } from '../../models/Product.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'FlashSale', schema: FlashSaleSchema },
      { name: 'Product', schema: ProductSchema },
    ]),
  ],
  controllers: [FlashSalesController],
  providers: [FlashSalesService],
  exports: [FlashSalesService],
})
export class FlashSalesModule {}
