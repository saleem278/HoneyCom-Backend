import mongoose, { Schema, Document } from 'mongoose';

/**
 * Audit log for admin impersonation. One document per impersonation
 * session: created when an admin starts impersonating, updated with
 * `endedAt` when they stop (or the token expires).
 *
 * This is the trail that lets us answer "did the admin do this as
 * themselves or while impersonating?". Indexed by admin and target so
 * support tooling can show recent impersonations either way.
 *
 * Sensitive fields (impersonator id, target id) are kept here rather
 * than baked into the order/dispute/etc. records — the audit log is
 * the canonical truth, and individual records just have the user id
 * the action was attributed to (which during impersonation is the
 * target user, not the admin).
 */
export interface IImpersonationEvent extends Document {
  impersonator: mongoose.Types.ObjectId;
  target: mongoose.Types.ObjectId;
  startedAt: Date;
  endedAt?: Date;
  ip?: string;
  userAgent?: string;
  /**
   * Free-text reason the admin gave when starting the session. Required
   * by the controller — supports compliance ("why did you log in as
   * this customer?").
   */
  reason: string;
}

const ImpersonationEventSchema = new Schema<IImpersonationEvent>(
  {
    impersonator: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    target: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    startedAt: { type: Date, default: Date.now, required: true },
    endedAt: { type: Date },
    ip: String,
    userAgent: String,
    reason: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: true },
);

ImpersonationEventSchema.index({ startedAt: -1 });

// Export both the schema (for MongooseModule.forFeature) and a guard
// against the legacy direct-model export pattern. New consumers should
// inject via @InjectModel('ImpersonationEvent') rather than touching
// the model directly.
export { ImpersonationEventSchema };
export const ImpersonationEvent = mongoose.models.ImpersonationEvent
  || mongoose.model<IImpersonationEvent>('ImpersonationEvent', ImpersonationEventSchema);
