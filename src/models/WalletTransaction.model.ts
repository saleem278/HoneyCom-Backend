import mongoose, { Schema, Document } from 'mongoose';

export interface IWalletTransaction extends Document {
  user: mongoose.Types.ObjectId;
  amount: number;
  type: 'credit' | 'debit';
  reason: 'topup' | 'order_payment' | 'refund' | 'admin_credit' | 'admin_debit';
  description: string;
  orderId?: mongoose.Types.ObjectId;
  balanceAfter: number;
  createdAt: Date;
  updatedAt: Date;
}

const WalletTransactionSchema: Schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: [0, 'Amount cannot be negative'] },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    reason: {
      type: String,
      enum: ['topup', 'order_payment', 'refund', 'admin_credit', 'admin_debit'],
      required: true,
    },
    description: { type: String, required: true, trim: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: true, collection: 'wallet_transactions' },
);

WalletTransactionSchema.index({ user: 1, createdAt: -1 });
WalletTransactionSchema.index({ user: 1 });

export const WalletTransaction = mongoose.model<IWalletTransaction>(
  'WalletTransaction',
  WalletTransactionSchema,
);
export { WalletTransactionSchema };
export default WalletTransaction;
