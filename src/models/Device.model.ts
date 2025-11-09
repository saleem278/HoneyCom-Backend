import mongoose, { Schema, Document } from 'mongoose';

export interface IDevice extends Document {
  user: mongoose.Types.ObjectId;
  deviceToken: string;
  platform: 'ios' | 'android';
  appVersion: string;
  lastActive: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceSchema: Schema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deviceToken: {
      type: String,
      required: true,
      unique: true,
    },
    platform: {
      type: String,
      enum: ['ios', 'android'],
      required: true,
    },
    appVersion: {
      type: String,
      required: true,
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'devices', // Explicitly set collection name
  }
);

// Indexes
DeviceSchema.index({ user: 1 });
DeviceSchema.index({ deviceToken: 1 });
DeviceSchema.index({ platform: 1 });

export const Device = mongoose.model<IDevice>('Device', DeviceSchema);
export { DeviceSchema };
export default Device;

