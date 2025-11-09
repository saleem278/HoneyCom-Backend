import mongoose, { Schema, Document } from 'mongoose';

export interface IBlogCategory extends Document {
  name: string;
  slug: string;
  description?: string;
  parent?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BlogCategorySchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a category name'],
      trim: true,
      unique: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      maxlength: [500, 'Description must be less than 500 characters'],
    },
    parent: {
      type: Schema.Types.ObjectId,
      ref: 'BlogCategory',
    },
  },
  {
    timestamps: true,
    collection: 'blogcategories', // Explicitly set collection name
  }
);

// Index
BlogCategorySchema.index({ slug: 1 });
BlogCategorySchema.index({ parent: 1 });

export const BlogCategory = mongoose.model<IBlogCategory>('BlogCategory', BlogCategorySchema);
export { BlogCategorySchema };