import mongoose, { Schema, Document } from 'mongoose';

export interface IReviewReply {
  body: string;
  author: 'admin' | 'seller';
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReviewReport {
  reporter: mongoose.Types.ObjectId;
  reason: string;
  createdAt: Date;
}

export interface IReview extends Document {
  product: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  rating: number;
  comment: string;
  images?: string[];
  verifiedPurchase: boolean;
  helpful: number;
  helpfulUsers?: mongoose.Types.ObjectId[];
  status: 'pending' | 'approved' | 'rejected';
  /** Optional admin/seller public reply shown under the review. */
  reply?: IReviewReply;
  /** Optional rejection reason captured by the moderator. */
  rejectionReason?: string;
  /** Id of the admin/staff who moderated this review. */
  moderatedBy?: mongoose.Types.ObjectId;
  /** Timestamp when the review was moderated. */
  moderatedAt?: Date;
  /** Customer abuse reports for this review. */
  reports?: IReviewReport[];
  /** Computed count of reports (for index/query convenience). */
  reportCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema: Schema = new Schema(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rating: {
      type: Number,
      required: [true, 'Please provide a rating'],
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5'],
    },
    comment: {
      type: String,
      required: [true, 'Please provide a review comment'],
      minlength: [10, 'Comment must be at least 10 characters'],
      maxlength: [1000, 'Comment cannot exceed 1000 characters'],
    },
    images: [
      {
        type: String,
      },
    ],
    verifiedPurchase: {
      type: Boolean,
      default: false,
    },
    helpful: {
      type: Number,
      default: 0,
    },
    helpfulUsers: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reply: {
      body: { type: String, maxlength: 2000 },
      author: { type: String, enum: ['admin', 'seller'] },
      authorName: { type: String },
      createdAt: { type: Date },
      updatedAt: { type: Date },
    },
    rejectionReason: { type: String, maxlength: 500 },
    moderatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    moderatedAt: { type: Date },
    reports: [
      {
        reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        reason: { type: String, required: true, maxlength: 500 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    reportCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'reviews', // Explicitly set collection name
  }
);

// Recalculate product rating whenever a review is saved.
// Only approved reviews count toward the public rating.
ReviewSchema.post('save', async function () {
  try {
    const Review = this.constructor as mongoose.Model<IReview>;
    const reviews = await Review.find({ product: this.product, status: 'approved' });
    // Guard against division-by-zero: if no approved reviews exist, reset to 0.
    const avgRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;
    await mongoose.model('Product').findByIdAndUpdate(this.product, {
      rating: Math.round(avgRating * 10) / 10,
      numReviews: reviews.length,
    });
  } catch (err) {
    // Post-save hooks must never throw — Mongoose silently swallows the
    // error but the save has already committed, so we just log.
    // eslint-disable-next-line no-console
    console.error(`[ReviewSchema.post('save')] Failed to update product rating:`, err);
  }
});

ReviewSchema.index({ product: 1, user: 1 }, { unique: true });
ReviewSchema.index({ product: 1, status: 1 });
ReviewSchema.index({ reportCount: -1 });
ReviewSchema.index({ status: 1, createdAt: -1 });

export const Review = mongoose.model<IReview>('Review', ReviewSchema);
export { ReviewSchema };

