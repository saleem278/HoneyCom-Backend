import mongoose, { Schema, Document } from 'mongoose';

export interface IContentVersion extends Document {
  contentType: 'page' | 'blog';
  contentId: mongoose.Types.ObjectId;
  version: number;
  title: string;
  content: string;
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const ContentVersionSchema: Schema = new Schema(
  {
    contentType: {
      type: String,
      enum: ['page', 'blog'],
      required: true,
    },
    contentId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
    },
    metaTitle: {
      type: String,
    },
    metaDescription: {
      type: String,
    },
    keywords: {
      type: [String],
      default: [],
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'contentversions',
  }
);

// Index for efficient queries
ContentVersionSchema.index({ contentId: 1, contentType: 1, version: -1 });

export const ContentVersion = mongoose.model<IContentVersion>('ContentVersion', ContentVersionSchema);
export { ContentVersionSchema };

