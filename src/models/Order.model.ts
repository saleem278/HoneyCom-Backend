import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderItem {
  product: mongoose.Types.ObjectId;
  /**
   * Seller who owns this line item. Snapshotted at order-creation time
   * from product.seller so seller-side queries don't need to join
   * through Product, and so reassignment of a product's seller later
   * doesn't rewrite history. Optional on the type for legacy rows that
   * predate this field; new orders always populate it.
   */
  seller?: mongoose.Types.ObjectId;
  name: string;
  quantity: number;
  price: number;
  image: string;
  variants?: Record<string, string>;
  // Per-line-item status — optional. When unset, the consumer should fall
  // back to the order-level `status` field. Will be populated once the
  // per-line-item migration ships and the seller dashboard learns to
  // update individual items (e.g. partial shipments where one item ships
  // and another is still being prepared). Until then, all items inherit
  // the parent order status.
  status?: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  // Free-text note from the seller about this specific item — e.g.
  // "Backordered, expect 2 weeks". Surfaced in the customer's order
  // detail next to the line.
  statusNote?: string;
  // When the line-item status last changed. Used to render relative
  // "Updated 2 days ago" copy. Optional — pre-existing orders won't have it.
  statusUpdatedAt?: Date;
  // Platform commission fields — snapshotted at order-creation time so
  // rate changes don't retroactively alter historical earnings. Optional
  // on the type; legacy orders that predate this field have no commission
  // data and callers should fall back to price*quantity for those rows.
  commissionRate?: number;    // platform rate at time of order (e.g. 0.10 = 10%)
  commissionAmount?: number;  // platform's cut for this line item
  sellerEarning?: number;     // seller's net (price*qty − commissionAmount)
}

export interface IOrder extends Document {
  orderNumber: string;
  customer: mongoose.Types.ObjectId;
  items: IOrderItem[];
  shippingAddress: mongoose.Types.ObjectId;
  billingAddress?: mongoose.Types.ObjectId;
  paymentMethod: string;
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  currency: string; // Currency code (USD, INR, EUR, etc.)
  exchangeRate?: number; // Exchange rate at time of order (if conversion was applied)
  subtotal: number;
  tax: number;
  shipping: number;
  /** Carrier / method label chosen at checkout (e.g. "Standard Delivery"). */
  shippingMethod?: string;
  discount: number;
  /** Discount applied by redeeming loyalty points at checkout (in base currency). */
  loyaltyDiscount?: number;
  /** Loyalty points redeemed on this order (for refund/audit). */
  loyaltyPointsRedeemed?: number;
  total: number;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  /**
   * Return-request lifecycle, independent of the fulfilment `status`. A customer
   * return on a non-auto-refundable order (COD/PayPal) sets this to
   * 'requested' while the order stays 'delivered' — money and the terminal
   * 'refunded' status are only finalized once an admin processes the refund.
   * Undefined when no return has been requested.
   */
  returnStatus?: 'requested' | 'approved' | 'rejected';
  /** Timestamp of the most recent return request, for admin triage. */
  returnRequestedAt?: Date;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: Date;
  couponCode?: string;
  notes?: string;
  /** AO-12: cumulative amount refunded so far (supports partial refunds). */
  refundedAmount?: number;
  deliverySlot?: mongoose.Types.ObjectId;
  deliverySlotLabel?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema: Schema = new Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: 'Product',
          required: true,
        },
        seller: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          // Not strictly required at the schema layer — legacy orders
          // predate this field and Mongoose would otherwise refuse to
          // save them. The order create path always sets it; we index
          // it for the seller-orders query and tolerate null on reads.
          index: true,
        },
        name: {
          type: String,
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: [1, 'Quantity must be at least 1'],
        },
        price: {
          type: Number,
          required: true,
          min: [0, 'Item price cannot be negative'],
          max: [10000000, 'Item price cannot exceed 10,000,000'],
        },
        image: {
          type: String,
          required: true,
        },
        variants: {
          type: Map,
          of: String,
        },
        // Optional per-line-item status. See IOrderItem comment — when
        // omitted, callers fall back to the parent order's status. Mongoose
        // doesn't add a default so saved documents keep their existing shape.
        status: {
          type: String,
          enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
        },
        statusNote: {
          type: String,
          maxlength: 500,
        },
        statusUpdatedAt: {
          type: Date,
        },
        commissionRate: {
          type: Number,
          min: 0,
          max: 1,
        },
        commissionAmount: {
          type: Number,
          min: 0,
        },
        sellerEarning: {
          type: Number,
          min: 0,
        },
      },
    ],
    shippingAddress: {
      type: Schema.Types.ObjectId,
      ref: 'Address',
      required: true,
    },
    billingAddress: {
      type: Schema.Types.ObjectId,
      ref: 'Address',
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ['razorpay', 'paypal', 'cash_on_delivery'],
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    razorpayOrderId: {
      type: String,
    },
    razorpayPaymentId: {
      type: String,
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
      enum: ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY'],
    },
    exchangeRate: {
      type: Number,
      default: 1, // 1 means no conversion, prices are in base currency
    },
    subtotal: {
      type: Number,
      required: true,
    },
    tax: {
      type: Number,
      default: 0,
    },
    shipping: {
      type: Number,
      default: 0,
    },
    shippingMethod: {
      type: String,
    },
    discount: {
      type: Number,
      default: 0,
    },
    loyaltyDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },
    loyaltyPointsRedeemed: {
      type: Number,
      default: 0,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'],
      default: 'pending',
    },
    returnStatus: {
      type: String,
      enum: ['requested', 'approved', 'rejected'],
    },
    returnRequestedAt: {
      type: Date,
    },
    trackingNumber: {
      type: String,
    },
    carrier: {
      type: String,
    },
    estimatedDelivery: {
      type: Date,
    },
    couponCode: {
      type: String,
    },
    notes: {
      type: String,
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliverySlot: {
      type: Schema.Types.ObjectId,
      ref: 'DeliverySlot',
    },
    deliverySlotLabel: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'orders', // Explicitly set collection name
  }
);

// Generate order number
OrderSchema.pre('save', async function (next) {
  if (!this.isNew || this.orderNumber) {
    return next();
  }
  try {
    const OrderModel = mongoose.models.Order || mongoose.model('Order', OrderSchema);
    const count = await OrderModel.countDocuments();
    this.orderNumber = `ORD-${String(Date.now()).slice(-8)}-${String(count + 1).padStart(4, '0')}`;
  } catch (error) {
    // Fallback if model not found
    this.orderNumber = `ORD-${String(Date.now()).slice(-8)}-${Math.floor(Math.random() * 10000)}`;
  }
  next();
});

OrderSchema.index({ customer: 1, createdAt: -1 });
OrderSchema.index({ orderNumber: 1 }, { unique: true });
OrderSchema.index({ status: 1, createdAt: -1 });
// Sparse so non-Stripe orders (cash on delivery / paypal) don't bloat the index.
// The webhook handler does findOne({ paymentIntentId }), which gets indexed lookups.
OrderSchema.index({ paymentIntentId: 1 }, { sparse: true });
// Seller-orders query: find every order containing a line item this
// seller owns. Mongo can use a multikey index on `items.seller`.
OrderSchema.index({ 'items.seller': 1, createdAt: -1 });
// Coupon analytics: find all orders that used a given coupon code.
OrderSchema.index({ couponCode: 1 }, { sparse: true });
// Admin financial reports often filter by payment status + date.
OrderSchema.index({ paymentStatus: 1, createdAt: -1 });

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
export { OrderSchema };

