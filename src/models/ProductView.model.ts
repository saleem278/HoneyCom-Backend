import mongoose, { Schema, Document } from 'mongoose';

export interface IProductView extends Document {
  product: mongoose.Types.ObjectId;
  viewedAt: Date;
}

const ProductViewSchema: Schema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
      // TTL index: documents expire after 24 hours (86400 seconds)
      index: { expireAfterSeconds: 86400 },
    },
  },
  {
    timestamps: false,
    collection: 'product_views',
  }
);

export const ProductView = mongoose.model<IProductView>('ProductView', ProductViewSchema);
export { ProductViewSchema };
