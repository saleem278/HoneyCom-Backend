import mongoose, { Schema, Document } from 'mongoose';

export interface IBroadcast extends Document {
  title: string;
  message: string;
  type: 'promotion' | 'system' | 'other';
  channels: ('inApp' | 'email')[];
  /** Targeting: roles[] | 'all' | specific userIds */
  targetRoles: string[];
  targetUserIds: mongoose.Types.ObjectId[];
  /** Optional deep-link / action URL written into Notification.data */
  actionUrl?: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
  scheduledAt?: Date;
  sentAt?: Date;
  createdBy: mongoose.Types.ObjectId;
  /** Denormalised counts updated at send-time */
  recipientCount: number;
  deliveredCount: number;
  readCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const BroadcastSchema: Schema = new Schema(
  {
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
      enum: ['promotion', 'system', 'other'],
      default: 'promotion',
    },
    channels: {
      type: [String],
      enum: ['inApp', 'email'],
      default: ['inApp'],
    },
    targetRoles: {
      type: [String],
      default: [],
    },
    targetUserIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    actionUrl: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'sending', 'sent', 'failed'],
      default: 'draft',
    },
    scheduledAt: {
      type: Date,
    },
    sentAt: {
      type: Date,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipientCount: {
      type: Number,
      default: 0,
    },
    deliveredCount: {
      type: Number,
      default: 0,
    },
    readCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'broadcasts',
  },
);

BroadcastSchema.index({ status: 1 });
BroadcastSchema.index({ scheduledAt: 1 });
BroadcastSchema.index({ createdAt: -1 });
BroadcastSchema.index({ createdBy: 1 });

export const Broadcast = mongoose.model<IBroadcast>('Broadcast', BroadcastSchema);
export { BroadcastSchema };
export default Broadcast;
