import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IPage } from '../../models/Page.model';
import { IBlog } from '../../models/Blog.model';

@Injectable()
export class CmsSchedulerService {
  constructor(
    @InjectModel('Page') private pageModel: Model<IPage>,
    @InjectModel('Blog') private blogModel: Model<IBlog>,
  ) {}

  /**
   * Check and publish scheduled content every minute
   * This runs every minute to check if any scheduled pages or blog posts
   * should be published based on their scheduledAt date
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async publishScheduledContent() {
    const now = new Date();
    
    try {
      // Publish scheduled pages
      const scheduledPages = await this.pageModel.updateMany(
        {
          status: 'scheduled',
          scheduledAt: { $lte: now },
        },
        {
          $set: {
            status: 'published',
            publishedAt: now,
          },
        }
      );

      // Publish scheduled blog posts
      const scheduledPosts = await this.blogModel.updateMany(
        {
          status: 'scheduled',
          scheduledAt: { $lte: now },
        },
        {
          $set: {
            status: 'published',
            publishedAt: now,
          },
        }
      );

      if (scheduledPages.modifiedCount > 0 || scheduledPosts.modifiedCount > 0) {
        console.log(
          `Published ${scheduledPages.modifiedCount} pages and ${scheduledPosts.modifiedCount} blog posts`
        );
      }
    } catch (error) {
      console.error('Error publishing scheduled content:', error);
    }
  }
}

