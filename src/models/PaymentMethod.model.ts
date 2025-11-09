import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentMethod extends Document {
  user: mongoose.Types.ObjectId;
  type: 'card' | 'paypal';
  // NEVER store full card numbers - use Stripe payment method ID instead
  stripePaymentMethodId?: string; // Token from Stripe (secure)
  cardHolderName?: string;
  expiryMonth?: string;
  expiryYear?: string;
  last4?: string; // Only last 4 digits
  brand?: string; // e.g., 'visa', 'mastercard'
  paypalEmail?: string; // For PayPal only
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentMethodSchema: Schema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['card', 'paypal'],
      required: true,
    },
    // NEVER store full card numbers - use Stripe payment method ID
    stripePaymentMethodId: {
      type: String,
      // Only required for card type
    },
    cardHolderName: {
      type: String,
    },
    expiryMonth: {
      type: String,
    },
    expiryYear: {
      type: String,
    },
    last4: {
      type: String,
    },
    brand: {
      type: String,
    },
    paypalEmail: {
      type: String,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'paymentmethods', // Explicitly set collection name
  }
);

PaymentMethodSchema.index({ user: 1 });

export const PaymentMethod = mongoose.model<IPaymentMethod>('PaymentMethod', PaymentMethodSchema);
export { PaymentMethodSchema };

