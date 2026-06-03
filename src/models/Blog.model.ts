import mongoose, { Schema, Document } from 'mongoose';

export interface IBlog extends Document {
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  featuredImage?: string;
  category: mongoose.Types.ObjectId;
  tags: string[];
  author: mongoose.Types.ObjectId;
  status: 'draft' | 'published' | 'scheduled';
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[];
  publishedAt?: Date;
  scheduledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BlogSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Please provide a blog title'],
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
      required: [true, 'Please provide blog content'],
    },
    excerpt: {
      type: String,
      maxlength: [500, 'Excerpt must be less than 500 characters'],
    },
    featuredImage: {
      type: String,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'BlogCategory',
      required: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'scheduled'],
      default: 'draft',
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
    publishedAt: {
      type: Date,
    },
    scheduledAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'blogs', // Explicitly set collection name
  }
);

// Indexes
BlogSchema.index({ slug: 1 });
BlogSchema.index({ status: 1 });
BlogSchema.index({ category: 1 });
BlogSchema.index({ tags: 1 });

export const Blog = mongoose.model<IBlog>('Blog', BlogSchema);
export { BlogSchema };

