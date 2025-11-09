import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CmsController } from './cms.controller';
import { CmsService } from './cms.service';
import { Page, PageSchema } from '../../models/Page.model';
import { Blog, BlogSchema } from '../../models/Blog.model';
import { BlogCategory, BlogCategorySchema } from '../../models/BlogCategory.model';
import { Media, MediaSchema } from '../../models/Media.model';
import { Menu, MenuSchema } from '../../models/Menu.model';
import { Form, FormSchema } from '../../models/Form.model';
import { FormSubmission, FormSubmissionSchema } from '../../models/FormSubmission.model';
import { AuthModule } from '../auth/auth.module';

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
    ]),
    AuthModule,
  ],
  controllers: [CmsController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}

