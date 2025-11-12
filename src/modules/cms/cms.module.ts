import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CmsController } from './cms.controller';
import { CmsService } from './cms.service';
import { CmsSchedulerService } from './cms-scheduler.service';
import { Page, PageSchema } from '../../models/Page.model';
import { Blog, BlogSchema } from '../../models/Blog.model';
import { BlogCategory, BlogCategorySchema } from '../../models/BlogCategory.model';
import { Media, MediaSchema } from '../../models/Media.model';
import { Menu, MenuSchema } from '../../models/Menu.model';
import { Form, FormSchema } from '../../models/Form.model';
import { FormSubmission, FormSubmissionSchema } from '../../models/FormSubmission.model';
import { ContentVersion, ContentVersionSchema } from '../../models/ContentVersion.model';
import { Widget, WidgetSchema } from '../../models/Widget.model';
import { AuthModule } from '../auth/auth.module';
import { EmailService } from '../../services/email.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Page', schema: PageSchema },
      { name: 'Blog', schema: BlogSchema },
      { name: 'BlogCategory', schema: BlogCategorySchema },
      { name: 'Media', schema: MediaSchema },
      { name: 'Menu', schema: MenuSchema },
      { name: 'Form', schema: FormSchema },
      { name: 'FormSubmission', schema: FormSubmissionSchema },
      { name: 'ContentVersion', schema: ContentVersionSchema },
      { name: 'Widget', schema: WidgetSchema },
    ]),
    ScheduleModule.forRoot(),
    ConfigModule,
    AuthModule,
  ],
  controllers: [CmsController],
  providers: [CmsService, CmsSchedulerService, EmailService],
  exports: [CmsService],
})
export class CmsModule {}

