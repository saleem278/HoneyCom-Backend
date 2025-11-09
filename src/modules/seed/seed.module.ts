import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SeedService } from './seed.service';
import { SeedController } from './seed.controller';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../../models/User.model';
// Don't import Product here - it has multiple required fields, gets registered globally
// Don't import Category, Blog, Page here - importing them registers the models globally
// They will be imported and registered dynamically in seed.service.ts when needed
// Don't import Order, Review, Cart here - they have required user/customer fields, get registered globally
// Don't import Coupon here - it has multiple required fields, gets registered globally
// Don't import Media here - it has multiple required fields, gets registered globally
// Don't import Menu here - it has required location field, gets registered globally
// Don't import Form here - it has validation that requires fields, gets registered globally
// Don't import BlogCategory here - it has required slug field and gets registered globally
// Don't import Address, PaymentMethod here - they have required user fields, get registered globally

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    
    // Database connection
    MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/honey-ecommerce', {
      connectionFactory: (connection) => {
        connection.on('connected', () => {
          // MongoDB Connected
        });
        return connection;
      },
    }),

    // Feature models - Don't register Category, Blog, Page here
    // They will be registered dynamically when needed to avoid validation issues
    MongooseModule.forFeature([
      { name: 'User', schema: UserSchema },
      // Product removed - has multiple required fields, will be registered dynamically
      // Order, Review, Cart removed - have required user/customer fields, will be registered dynamically
      // Coupon removed - has multiple required fields, will be registered dynamically
      // Media removed - has multiple required fields, will be registered dynamically
      // Menu removed - has required location, will be registered dynamically
      // Form removed - has validation, will be registered dynamically
      // BlogCategory removed - has required slug, will be registered dynamically
    ]),
    // Address and PaymentMethod removed - have required user fields, will be registered dynamically
    AuthModule,
  ],
  controllers: [SeedController],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}

