import mongoose, { Schema, Document } from 'mongoose';

export interface IProductVariant {
  name: string;
  options: string[];
}

export interface IProductQnA {
  q: string;
  a: string;
}

export interface IProduct extends Document {
  name: string;
  description: string;
  sku: string;
  price: number;
  compareAtPrice?: number;
  category: mongoose.Types.ObjectId;
  brand?: mongoose.Types.ObjectId;
  seller: mongoose.Types.ObjectId;
  images: string[];
  inventory: number;
  variants?: IProductVariant[];
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  status: 'pending' | 'approved' | 'rejected' | 'inactive';
  rejectionReason?: string;
  featured: boolean;
  rating: number;
  numReviews: number;
  tags: string[];
  qna?: IProductQnA[];
  specifications?: Array<{ label: string; value: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a product name'],
      trim: true,
      minlength: [3, 'Product name must be at least 3 characters'],
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      required: [true, 'Please provide a product description'],
      minlength: [10, 'Description must be at least 10 characters'],
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
    },
    price: {
      type: Number,
      required: [true, 'Please provide a price'],
      min: [0.01, 'Price must be at least 0.01'],
      max: [10000000, 'Price cannot exceed 10,000,000'],
    },
    compareAtPrice: {
      type: Number,
      min: [0, 'Compare at price must be positive'],
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    brand: {
      type: Schema.Types.ObjectId,
      ref: 'Brand',
      index: true,
    },
    seller: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    images: [
      {
        type: String,
        required: true,
      },
    ],
    inventory: {
      type: Number,
      required: true,
      min: [0, 'Inventory cannot be negative'],
      max: [10000000, 'Inventory cannot exceed 10 million units'],
      default: 0,
    },
    variants: [
      {
        name: {
          type: String,
          required: true,
        },
        options: [
          {
            type: String,
            required: true,
          },
        ],
      },
    ],
    weight: {
      type: Number,
      min: [0, 'Weight must be positive'],
    },
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'inactive'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: [1000, 'Rejection reason cannot exceed 1000 characters'],
    },
    featured: {
      type: Boolean,
      default: false,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    numReviews: {
      type: Number,
      default: 0,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    qna: [
      {
        q: { type: String, trim: true, maxlength: 500 },
        a: { type: String, trim: true, maxlength: 2000 },
      },
    ],
    specifications: [
      {
        label: { type: String, trim: true, maxlength: 100 },
        value: { type: String, trim: true, maxlength: 500 },
      },
    ],
  },
  {
    timestamps: true,
    collection: 'products', // Explicitly set collection name
    strictPopulate: false, // Allow populating fields even if not strictly defined
  }
);

// Text search across name, description, and tags
ProductSchema.index({ name: 'text', description: 'text', tags: 'text' });
// Category + status compound (product listing page filter)
ProductSchema.index({ category: 1, status: 1 });
// Brand + status compound (brand filter / brand page)
ProductSchema.index({ brand: 1, status: 1 });
// Seller product list (seller dashboard)
ProductSchema.index({ seller: 1, status: 1 });
// Price range filter — supports minPrice/maxPrice queries efficiently
ProductSchema.index({ price: 1, status: 1 });
// Featured products query (homepage)
ProductSchema.index({ featured: 1, status: 1 });

export const Product = mongoose.model<IProduct>('Product', ProductSchema);
export { ProductSchema };

