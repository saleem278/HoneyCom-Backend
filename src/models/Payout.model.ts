import mongoose, { Schema, Document } from 'mongoose';

export interface IPayout extends Document {
  seller: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  /** PAY-03: "cancelled" added so sellers can self-cancel pending requests */
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled';
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
  ifscCode?: string;
  swiftCode?: string;
  upiId?: string;
  notes?: string;
  adminNotes?: string;
  processedBy?: mongoose.Types.ObjectId;
  processedAt?: Date;
  rejectionReason?: string;
  transferReference?: string;
  paymentMethod?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PayoutSchema: Schema = new Schema(
  {
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: [1, 'Payout amount must be at least 1'] },
    currency: { type: String, default: 'INR', trim: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid', 'rejected', 'cancelled'],
      default: 'pending',
    },
    bankAccountName: { type: String, required: true, trim: true },
    bankAccountNumber: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    ifscCode: { type: String, trim: true },
    swiftCode: { type: String, trim: true },
    upiId: { type: String, trim: true },
    notes: { type: String, trim: true },
    adminNotes: { type: String, trim: true },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    processedAt: { type: Date },
    rejectionReason: { type: String, trim: true },
    transferReference: { type: String, trim: true },
    paymentMethod: { type: String, trim: true },
    paidAt: { type: Date },
  },
  { timestamps: true, collection: 'payouts' },
);

PayoutSchema.index({ seller: 1, status: 1 });
PayoutSchema.index({ status: 1 });
PayoutSchema.index({ createdAt: -1 });

export const Payout = mongoose.model<IPayout>('Payout', PayoutSchema);
export { PayoutSchema };
export default Payout;
