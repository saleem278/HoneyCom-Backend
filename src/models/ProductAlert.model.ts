import mongoose, { Schema, Document } from 'mongoose';

export interface IProductAlert extends Document {
  user: mongoose.Types.ObjectId;
  product: mongoose.Types.ObjectId;
  type: 'price_drop' | 'back_in_stock';
  targetPrice?: number;
  active: boolean;
  notifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProductAlertSchema: Schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    type: { type: String, enum: ['price_drop', 'back_in_stock'], required: true },
    targetPrice: { type: Number, min: 0 },
    active: { type: Boolean, default: true, index: true },
    notifiedAt: { type: Date },
  },
  { timestamps: true },
);

ProductAlertSchema.index({ user: 1, product: 1, type: 1 }, { unique: true });
ProductAlertSchema.index({ product: 1, type: 1, active: 1 });

export const ProductAlert = mongoose.model<IProductAlert>('ProductAlert', ProductAlertSchema);
export { ProductAlertSchema };
