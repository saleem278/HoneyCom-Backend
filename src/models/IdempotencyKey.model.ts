import mongoose, { Schema, Document } from 'mongoose';

/**
 * Server-side idempotency record. Maps a client-supplied Idempotency-Key
 * (scoped per user + scope) to the resource that was created on the first
 * successful request. A retry with the same key returns the same resource
 * instead of creating a duplicate.
 *
 * The unique compound index on (key, user, scope) is the concurrency guard:
 * two simultaneous requests with the same key race to insert; exactly one
 * wins, the loser (duplicate-key error) reads back the winner's orderId.
 */
export interface IIdempotencyKey extends Document {
  key: string;
  user: mongoose.Types.ObjectId;
  scope: string; // e.g. 'order-create' — lets one key namespace cover many flows
  orderId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const IdempotencyKeySchema = new Schema<IIdempotencyKey>(
  {
    key: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scope: { type: String, required: true, default: 'order-create' },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  },
  { timestamps: true },
);

// Unique per (key, user, scope): the same key from different users (or for a
// different flow) never collides, but a retry by the same user does.
IdempotencyKeySchema.index({ key: 1, user: 1, scope: 1 }, { unique: true });

// TTL: keys are only useful for the lifetime of a checkout retry. Auto-expire
// after 24h so the collection doesn't grow unbounded.
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const IdempotencyKey = mongoose.model<IIdempotencyKey>(
  'IdempotencyKey',
  IdempotencyKeySchema,
);
export { IdempotencyKeySchema };
