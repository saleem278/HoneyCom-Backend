import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ContactController } from './contact.controller';
import { SettingsSchema } from '../../models/Settings.model';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from '../../services/email.service';
import { EmailTemplatesService } from '../../services/email-templates.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Settings', schema: SettingsSchema },
    ]),
    AuthModule,
  ],
  controllers: [SettingsController, ContactController],
  providers: [SettingsService, EmailService, EmailTemplatesService],
  exports: [SettingsService],
})
export class SettingsModule {}


