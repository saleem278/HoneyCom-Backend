import mongoose, { Schema, Document } from 'mongoose';

export interface IWebhookEvent extends Document {
  eventId: string;       // Stripe event ID (e.g. evt_...)
  eventType: string;     // e.g. payment_intent.succeeded
  processedAt: Date;
  createdAt: Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    eventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// TTL: auto-delete records after 30 days — Stripe only retries within 3 days,
// so a 30-day window is more than sufficient to prevent double-processing.
WebhookEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookEvent = mongoose.model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);
export { WebhookEventSchema };
