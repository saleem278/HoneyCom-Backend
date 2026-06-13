import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailTemplateService } from './email-templates.service';
import { EmailTemplateSchema } from '../../models/EmailTemplate.model';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'EmailTemplate', schema: EmailTemplateSchema },
    ]),
    AuthModule,
  ],
  controllers: [EmailTemplatesController],
  providers: [EmailTemplateService],
  exports: [EmailTemplateService],
})
export class EmailTemplatesModule {}
