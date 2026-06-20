import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';
import { ThemeSchema } from '../../models/Theme.model';
import { UserSchema } from '../../models/User.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Theme', schema: ThemeSchema },
      { name: 'User', schema: UserSchema },
    ]),
  ],
  controllers: [ThemesController],
  providers: [ThemesService],
  exports: [ThemesService],
})
export class ThemesModule {}
