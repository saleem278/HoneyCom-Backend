import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { CollectionSchema } from '../../models/Collection.model';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Collection', schema: CollectionSchema },
    ]),
    AuthModule,
  ],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
