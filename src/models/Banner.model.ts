import mongoose, { Schema, Document } from 'mongoose';

export interface IBanner extends Document {
  title: string;
  description?: string;
  image: string;
  link?: string;
  position: 'top' | 'middle' | 'bottom' | 'sidebar';
  status: 'active' | 'inactive';
  startDate?: Date;
  endDate?: Date;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const BannerSchema: Schema = new Schema(
  {
    title: {
      type: String,
      required: [true, 'Banner title is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    image: {
      type: String,
      required: [true, 'Banner image is required'],
    },
    link: {
      type: String,
    },
    position: {
      type: String,
      enum: ['top', 'middle', 'bottom', 'sidebar'],
      default: 'top',
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'banners',
  }
);

BannerSchema.index({ position: 1, status: 1 });
BannerSchema.index({ order: 1 });

export const Banner = mongoose.model<IBanner>('Banner', BannerSchema);
export { BannerSchema };
export default Banner;

