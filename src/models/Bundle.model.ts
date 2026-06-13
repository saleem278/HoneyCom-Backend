import mongoose, { Schema, Document } from 'mongoose';

export interface IBundle extends Document {
  name: string;
  description?: string;
  products: mongoose.Types.ObjectId[];
  seller?: mongoose.Types.ObjectId;
  bundlePrice: number;
  originalPrice: number;
  discountPercent: number;
  image?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BundleSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Bundle name is required'],
      trim: true,
      maxlength: [200, 'Bundle name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
    },
    products: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
      },
    ],
    seller: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    bundlePrice: {
      type: Number,
      required: [true, 'Bundle price is required'],
      min: [0, 'Bundle price must be non-negative'],
    },
    originalPrice: {
      type: Number,
      required: [true, 'Original price is required'],
      min: [0, 'Original price must be non-negative'],
    },
    discountPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    image: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'bundles',
  }
);

BundleSchema.index({ seller: 1, isActive: 1 });
BundleSchema.index({ isActive: 1, createdAt: -1 });
BundleSchema.index({ products: 1 });

export const Bundle = mongoose.model<IBundle>('Bundle', BundleSchema);
export { BundleSchema };
