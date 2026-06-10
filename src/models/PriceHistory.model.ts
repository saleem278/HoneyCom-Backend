import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceHistory extends Document {
  product: mongoose.Types.ObjectId;
  price: number;
  compareAtPrice?: number;
  changedAt: Date;
  changedBy?: mongoose.Types.ObjectId;
}

const PriceHistorySchema: Schema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    compareAtPrice: {
      type: Number,
      min: 0,
    },
    changedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: false,
    collection: 'price_histories',
  }
);

export const PriceHistory = mongoose.model<IPriceHistory>('PriceHistory', PriceHistorySchema);
export { PriceHistorySchema };
