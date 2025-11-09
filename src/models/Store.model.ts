import mongoose, { Schema, Document } from 'mongoose';

export interface IStore extends Document {
  seller: mongoose.Types.ObjectId;
  storeName: string;
  slug: string;
  description?: string;
  logo?: string;
  banner?: string;
  address?: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  contact: {
    email?: string;
    phone?: string;
    website?: string;
  };
  socialMedia?: {
    facebook?: string;
    twitter?: string;
    instagram?: string;
  };
  settings: {
    shippingPolicy?: string;
    returnPolicy?: string;
    refundPolicy?: string;
    autoAcceptOrders?: boolean;
    shippingMethods?: string[];
  };
  status: 'active' | 'inactive';
  createdAt: Date;
  updatedAt: Date;
}

const StoreSchema: Schema = new Schema(
  {
    seller: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    storeName: {
      type: String,
      required: [true, 'Store name is required'],
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
      trim: true,
    },
    logo: {
      type: String,
    },
    banner: {
      type: String,
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String,
    },
    contact: {
      email: String,
      phone: String,
      website: String,
    },
    socialMedia: {
      facebook: String,
      twitter: String,
      instagram: String,
    },
    settings: {
      shippingPolicy: String,
      returnPolicy: String,
      refundPolicy: String,
      autoAcceptOrders: {
        type: Boolean,
        default: false,
      },
      shippingMethods: [String],
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  {
    timestamps: true,
    collection: 'stores',
  }
);

StoreSchema.index({ seller: 1 });
StoreSchema.index({ slug: 1 });

export const Store = mongoose.model<IStore>('Store', StoreSchema);
export { StoreSchema };
export default Store;

