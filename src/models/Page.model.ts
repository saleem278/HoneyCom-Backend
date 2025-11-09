import mongoose, { Schema, Document } from 'mongoose';

export interface IPage extends Document {
  title: string;
  slug: string;
  content: string;
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[];
  status: 'draft' | 'published';
  author: mongoose.Types.ObjectId;
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PageSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a page title'],
      trim: true,
      maxlength: [200, 'Title must be less than 200 characters'],
    },
    slug: {
      type: String,
      required: [true, 'Please provide a slug'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Please provide a valid slug'],
    },
    content: {
      type: String,
      required: [true, 'Please provide page content'],
    },
    metaTitle: {
      type: String,
      maxlength: [60, 'Meta title must be less than 60 characters'],
    },
    metaDescription: {
      type: String,
      maxlength: [160, 'Meta description must be less than 160 characters'],
    },
    keywords: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    publishedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'pages', // Explicitly set collection name
  }
);

// Index for slug search
PageSchema.index({ slug: 1 });
PageSchema.index({ status: 1 });

export const Page = mongoose.model<IPage>('Page', PageSchema);
export { PageSchema };

