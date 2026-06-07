import mongoose, { Schema, Document } from 'mongoose';

export interface ICoupon extends Document {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minPurchase?: number;
  maxDiscount?: number;
  usageLimit?: number;
  usedCount: number;
  // Max redemptions allowed per individual user. null/undefined/0 = unlimited
  // per user (the pre-existing behaviour). Enforced atomically at order time
  // alongside the global usageLimit.
  perUserLimit?: number;
  // Per-user redemption counts, keyed by userId. Incremented atomically when a
  // coupon is redeemed so concurrent orders by the same user can't exceed
  // perUserLimit.
  userUsage?: Record<string, number>;
  validFrom: Date;
  validUntil: Date;
  status: 'active' | 'inactive';
  applicableProducts?: mongoose.Types.ObjectId[];
  applicableCategories?: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema: Schema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['percentage', 'fixed'],
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: [0, 'Value must be positive'],
    },
    minPurchase: {
      type: Number,
      min: [0, 'Minimum purchase must be positive'],
    },
    maxDiscount: {
      type: Number,
      min: [0, 'Maximum discount must be positive'],
    },
    usageLimit: {
      type: Number,
      min: [1, 'Usage limit must be at least 1'],
    },
    usedCount: {
      type: Number,
      default: 0,
      min: [0, 'Used count cannot be negative'],
    },
    perUserLimit: {
      type: Number,
      min: [1, 'Per-user limit must be at least 1'],
    },
    // Map of userId -> redemption count. Mongoose `Map` of Number; stored as a
    // BSON object. Default empty so atomic `$inc` on `userUsage.<id>` works.
    userUsage: {
      type: Map,
      of: Number,
      default: {},
    },
    validFrom: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    applicableProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    applicableCategories: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
  },
  {
    timestamps: true,
    collection: 'coupons', // Explicitly set collection name
  }
);

// Explicit unique index — the schema-level `unique: true` creates an index but
// doesn't guarantee the sparse/background options we want. Declare explicitly.
CouponSchema.index({ code: 1 }, { unique: true });
CouponSchema.index({ status: 1, validFrom: 1, validUntil: 1 });

export const Coupon = mongoose.model<ICoupon>('Coupon', CouponSchema);
export { CouponSchema };

