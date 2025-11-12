import mongoose, { Schema, Document } from 'mongoose';

export interface IWidget extends Document {
  name: string;
  type: 'text' | 'html' | 'image' | 'video' | 'custom';
  content: string;
  settings?: Record<string, any>;
  location?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WidgetSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a widget name'],
      trim: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ['text', 'html', 'image', 'video', 'custom'],
      default: 'html',
    },
    content: {
      type: String,
      required: true,
    },
    settings: {
      type: Schema.Types.Mixed,
      default: {},
    },
    location: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'widgets',
  }
);

// Index
WidgetSchema.index({ location: 1, isActive: 1 });

export const Widget = mongoose.model<IWidget>('Widget', WidgetSchema);
export { WidgetSchema };

