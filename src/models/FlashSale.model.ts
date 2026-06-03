import mongoose, { Document, Schema } from 'mongoose';

export interface IFlashSale extends Document {
  product: mongoose.Types.ObjectId;
  title?: string;
  originalPrice: number;
  salePrice: number;
  discountPercent: number;
  startTime: Date;
  endTime: Date;
  stockLimit: number;
  soldCount: number;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FlashSaleSchema: Schema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    title: { type: String, trim: true },
    originalPrice: { type: Number, required: true, min: 0 },
    salePrice: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, required: true, min: 0, max: 100 },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    stockLimit: { type: Number, default: 0, min: 0 },
    soldCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

FlashSaleSchema.index({ startTime: 1, endTime: 1 });
FlashSaleSchema.index({ isActive: 1, startTime: 1, endTime: 1 });
FlashSaleSchema.index({ product: 1 });

export const FlashSale = mongoose.model<IFlashSale>('FlashSale', FlashSaleSchema);
export { FlashSaleSchema };
