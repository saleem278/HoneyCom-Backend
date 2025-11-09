import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
  key: string;
  value: any;
  category: 'payment' | 'shipping' | 'tax' | 'email' | 'general';
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SettingsSchema: Schema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
    category: {
      type: String,
      enum: ['payment', 'shipping', 'tax', 'email', 'general'],
      required: true,
    },
    description: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'settings',
  }
);

SettingsSchema.index({ key: 1 });
SettingsSchema.index({ category: 1 });

export const Settings = mongoose.model<ISettings>('Settings', SettingsSchema);
export { SettingsSchema };
export default Settings;

