import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
// SP-01: memoryStorage keeps uploaded files in-memory buffers so we can stream
// them directly to Cloudinary without touching the filesystem.  diskStorage
// would leave file.buffer undefined, breaking both image upload and CSV import.
import multer from 'multer';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Product, ProductSchema } from '../../models/Product.model';
import { Category, CategorySchema } from '../../models/Category.model';
import { BrandSchema } from '../../models/Brand.model';
import { ProductAlert, ProductAlertSchema } from '../../models/ProductAlert.model';
import { SettingsSchema } from '../../models/Settings.model';
import { AuthModule } from '../auth/auth.module';
import { ExchangeRateService } from '../../services/exchange-rate.service';
import { MobileModule } from '../mobile/mobile.module';
import { EmailService } from '../../services/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Product', schema: ProductSchema },
      { name: 'Category', schema: CategorySchema },
      { name: 'Brand', schema: BrandSchema },
      { name: 'ProductAlert', schema: ProductAlertSchema },
      { name: 'Settings', schema: SettingsSchema },
    ]),
    MulterModule.register({
      storage: multer.memoryStorage(),
      fileFilter: (req, file, cb) => {
        const isImage = file.mimetype.startsWith('image/');
        const isCsv = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv');
        if (isImage || isCsv) {
          cb(null, true);
        } else {
          cb(new Error('Only image or CSV files are accepted'), false);
        }
      },
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
    AuthModule,
    MobileModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, ExchangeRateService, EmailService],
  exports: [ProductsService],
})
export class ProductsModule {}


