import mongoose, { Schema, Document } from 'mongoose';

export type LoyaltyTransactionType =
  | 'earn'
  | 'redeem'
  | 'admin_credit'
  | 'admin_debit'
  | 'expire';

export interface ILoyaltyTransaction extends Document {
  user: mongoose.Types.ObjectId;
  points: number;
  type: LoyaltyTransactionType;
  description: string;
  orderId?: mongoose.Types.ObjectId;
  balanceAfter: number;
  createdAt: Date;
  updatedAt: Date;
}

const LoyaltyTransactionSchema: Schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    points: { type: Number, required: true, min: [0, 'Points cannot be negative'] },
    type: {
      type: String,
      enum: ['earn', 'redeem', 'admin_credit', 'admin_debit', 'expire'],
      required: true,
    },
    description: { type: String, required: true, trim: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    balanceAfter: { type: Number, required: true, min: 0 },
  },
  { timestamps: true, collection: 'loyalty_transactions' },
);

LoyaltyTransactionSchema.index({ user: 1, createdAt: -1 });
LoyaltyTransactionSchema.index({ orderId: 1 });

export const LoyaltyTransaction = mongoose.model<ILoyaltyTransaction>(
  'LoyaltyTransaction',
  LoyaltyTransactionSchema,
);
export { LoyaltyTransactionSchema };
export default LoyaltyTransaction;
