import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IBroadcast } from '../../models/Broadcast.model';
import { INotification } from '../../models/Notification.model';
import { IUser } from '../../models/User.model';
import { EmailService } from '../../services/email.service';

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    @InjectModel('Broadcast') private broadcastModel: Model<IBroadcast>,
    @InjectModel('Notification') private notificationModel: Model<INotification>,
    @InjectModel('User') private userModel: Model<IUser>,
    private emailService: EmailService,
  ) {}

  /**
   * Every minute: find scheduled broadcasts whose scheduledAt has passed
   * and dispatch them (mirroring the CMS scheduler pattern).
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchScheduledBroadcasts() {
    const now = new Date();

    let dueBroadcasts: IBroadcast[] = [];
    try {
      dueBroadcasts = await this.broadcastModel
        .find({ status: 'scheduled', scheduledAt: { $lte: now } })
        .lean<IBroadcast[]>();
    } catch (err: any) {
      this.logger.error(`Scheduler: error fetching due broadcasts: ${err?.message || err}`);
      return;
    }

    if (dueBroadcasts.length === 0) return;

    for (const broadcast of dueBroadcasts) {
      try {
        // Mark as sending to prevent double-dispatch
        await this.broadcastModel.updateOne(
          { _id: broadcast._id, status: 'scheduled' },
          { $set: { status: 'sending' } },
        );

        const sent = await this.dispatchBroadcast(broadcast);

        await this.broadcastModel.updateOne(
          { _id: broadcast._id },
          { $set: { status: 'sent', sentAt: new Date(), recipientCount: sent } },
        );

        this.logger.log(
          `Scheduled broadcast "${broadcast.title}" dispatched to ${sent} users`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to dispatch broadcast ${String(broadcast._id)}: ${err?.message || err}`,
        );
        await this.broadcastModel.updateOne(
          { _id: broadcast._id },
          { $set: { status: 'failed' } },
        );
      }
    }
  }

  /** Shared dispatch logic reused by immediate-send and scheduler. */
  async dispatchBroadcast(broadcast: IBroadcast): Promise<number> {
    const userQuery = this.buildUserQuery(broadcast);
    const users = await this.userModel
      .find(userQuery)
      .select('_id email name')
      .lean<{ _id: any; email?: string; name?: string }[]>();

    if (users.length === 0) return 0;

    const broadcastId = broadcast._id;
    const actionData = broadcast.actionUrl ? { url: broadcast.actionUrl } : undefined;

    // --- In-app notifications (bulk insert) ---
    if (!broadcast.channels || broadcast.channels.includes('inApp')) {
      const docs = users.map((u) => ({
        user: u._id,
        broadcastId,
        title: broadcast.title,
        message: broadcast.message,
        type: broadcast.type,
        data: actionData,
        read: false,
        sentAt: new Date(),
      }));
      await this.notificationModel.insertMany(docs, { ordered: false });
    }

    // --- Email channel ---
    if (broadcast.channels && broadcast.channels.includes('email')) {
      const emailUsers = users.filter((u) => u.email);
      let emailsSent = 0;
      for (const u of emailUsers) {
        try {
          await this.emailService.sendEmail({
            to: u.email!,
            subject: broadcast.title,
            html: `<p>${broadcast.message}</p>${
              broadcast.actionUrl
                ? `<p><a href="${broadcast.actionUrl}">View details</a></p>`
                : ''
            }`,
            text: broadcast.message,
          });
          emailsSent++;
        } catch (emailErr: any) {
          // Non-fatal — log and continue
          this.logger.warn(`Email to ${u.email} failed: ${emailErr?.message}`);
        }
      }
      this.logger.log(
        `Email channel: ${emailsSent}/${emailUsers.length} sent for broadcast "${broadcast.title}"`,
      );
    }

    return users.length;
  }

  buildUserQuery(broadcast: IBroadcast): Record<string, unknown> {
    if (broadcast.targetUserIds && broadcast.targetUserIds.length > 0) {
      return { _id: { $in: broadcast.targetUserIds } };
    }
    if (broadcast.targetRoles && broadcast.targetRoles.length > 0) {
      return { status: 'active', role: { $in: broadcast.targetRoles } };
    }
    return { status: 'active' };
  }
}
