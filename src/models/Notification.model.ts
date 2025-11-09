import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  user: mongoose.Types.ObjectId;
  device?: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: 'order' | 'promotion' | 'system' | 'other';
  data?: Record<string, any>;
  read: boolean;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema: Schema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    device: {
      type: Schema.Types.ObjectId,
      ref: 'Device',
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [100, 'Title must be less than 100 characters'],
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: [500, 'Message must be less than 500 characters'],
    },
    type: {
      type: String,
      enum: ['order', 'promotion', 'system', 'other'],
      default: 'other',
    },
    data: {
      type: Schema.Types.Mixed,
    },
    read: {
      type: Boolean,
      default: false,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'notifications', // Explicitly set collection name
  }
);

// Indexes
NotificationSchema.index({ user: 1 });
NotificationSchema.index({ read: 1 });
NotificationSchema.index({ sentAt: -1 });
NotificationSchema.index({ type: 1 });

export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
export { NotificationSchema };
export default Notification;

