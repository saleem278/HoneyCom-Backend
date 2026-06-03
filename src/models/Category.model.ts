import mongoose, { Schema, Document } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  /** Emoji or short icon string shown in the homepage category pill row. */
  icon?: string;
  /** Surface this category in the homepage "Shop by Category" grid. */
  featured?: boolean;
  /** Manual sort order for storefront display (lower = first). */
  displayOrder?: number;
  parent?: mongoose.Types.ObjectId;
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a category name'],
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    description: {
      type: String,
      maxlength: [500, 'Description cannot exceed 500 characters'],
    },
    image: {
      type: String,
    },
    icon: {
      type: String,
      maxlength: [16, 'Icon must be a short string or emoji'],
    },
    featured: {
      type: Boolean,
      default: false,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    parent: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  {
    timestamps: true,
    collection: 'categories', // Explicitly set collection name
  }
);

// Generate slug from name
CategorySchema.pre('save', function (next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

CategorySchema.index({ slug: 1 });
CategorySchema.index({ parent: 1 });

export const Category = mongoose.model<ICategory>('Category', CategorySchema);
export { CategorySchema };

