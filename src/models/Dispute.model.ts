import mongoose, { Schema, Document } from 'mongoose';

export interface IDispute extends Document {
  order: mongoose.Types.ObjectId;
  customer: mongoose.Types.ObjectId;
  seller?: mongoose.Types.ObjectId;
  type: 'refund' | 'return' | 'quality' | 'delivery' | 'other';
  reason: string;
  description: string;
  status: 'open' | 'in_review' | 'resolved' | 'closed' | 'rejected';
  resolution?: string;
  resolutionNotes?: string;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  attachments?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const DisputeSchema: Schema = new Schema(
  {
    order: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    seller: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    type: {
      type: String,
      enum: ['refund', 'return', 'quality', 'delivery', 'other'],
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      minlength: [10, 'Description must be at least 10 characters'],
    },
    status: {
      type: String,
      enum: ['open', 'in_review', 'resolved', 'closed', 'rejected'],
      default: 'open',
    },
    resolution: {
      type: String,
      enum: ['refund', 'replacement', 'partial_refund', 'no_action', 'other'],
    },
    resolutionNotes: {
      type: String,
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    resolvedAt: {
      type: Date,
    },
    attachments: [
      {
        type: String,
      },
    ],
  },
  {
    timestamps: true,
    collection: 'disputes',
  }
);

// Indexes
DisputeSchema.index({ order: 1 });
DisputeSchema.index({ customer: 1 });
DisputeSchema.index({ seller: 1 });
DisputeSchema.index({ status: 1 });
DisputeSchema.index({ createdAt: -1 });

export const Dispute = mongoose.model<IDispute>('Dispute', DisputeSchema);
export { DisputeSchema };
export default Dispute;

