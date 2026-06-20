import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SellerModule } from './modules/seller/seller.module';
import { AdminModule } from './modules/admin/admin.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CmsModule } from './modules/cms/cms.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { DisputesModule } from './modules/disputes/disputes.module';
import { BrandsModule } from './modules/brands/brands.module';
import { BannersModule } from './modules/banners/banners.module';
import { StoresModule } from './modules/stores/stores.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SeedModule } from './modules/seed/seed.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { HealthModule } from './modules/health/health.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { FlashSalesModule } from './modules/flash-sales/flash-sales.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { ReferralModule } from './modules/referral/referral.module';
import { EmailTemplatesModule } from './modules/email-templates/email-templates.module';
import { BundlesModule } from './modules/bundles/bundles.module';
import { DeliverySlotsModule } from './modules/delivery-slots/delivery-slots.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { SearchModule } from './modules/search/search.module';
import { ThemesModule } from './modules/themes/themes.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    
    // Database — bootstrap.ts asserts MONGODB_URI is set before this module loads.
    MongooseModule.forRoot(process.env.MONGODB_URI as string, {
      connectionFactory: (connection) => {
        connection.on('connected', () => {
          // MongoDB Connected
        });
        return connection;
      },
    }),

    // Rate Limiting
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
        limit: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
      },
    ]),

    // Feature Modules
    HealthModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    CartModule,
    OrdersModule,
    CategoriesModule,
    ReviewsModule,
    SellerModule, 
    AdminModule,
    PaymentsModule,
    CmsModule,
    MobileModule,
    DisputesModule,
    BrandsModule,
    BannersModule,
    StoresModule,
    SettingsModule,
    CouponsModule,
    PayoutsModule,
    FlashSalesModule,
    LoyaltyModule,
    ReferralModule,
    EmailTemplatesModule,
    BundlesModule,
    DeliverySlotsModule,
    CollectionsModule,
    SearchModule,
    ThemesModule,
    SeedModule,
  ],
})
export class AppModule {}

