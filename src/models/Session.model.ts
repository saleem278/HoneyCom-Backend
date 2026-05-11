import mongoose, { Schema, Document } from 'mongoose';

/**
 * What the session token authorises. `session` is the normal
 * user-issued bearer (email/password, phone OTP, social). `impersonation`
 * tracks an admin acting as another user — the strategy treats both
 * as valid auth, but downstream code uses the discriminator to tag
 * audit rows and the UI banner.
 */
export type SessionPurpose = 'session' | 'impersonation';

export interface ISession extends Document {
  userId: mongoose.Types.ObjectId;
  token: string; // JWT token (hashed or just reference)
  deviceInfo?: {
    userAgent: string;
    platform: string;
    browser: string;
    os: string;
    deviceType: 'desktop' | 'mobile' | 'tablet';
  };
  location?: {
    ip: string;
    country?: string;
    city?: string;
    region?: string;
  };
  isActive: boolean;
  lastActivity: Date;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
  /** What the token grants. Defaults to 'session'. */
  purpose?: SessionPurpose;
  /** When purpose === 'impersonation', the admin id who triggered it. */
  impersonator?: mongoose.Types.ObjectId;
}

export const SessionSchema: Schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      index: true,
    },
    deviceInfo: {
      userAgent: String,
      platform: String,
      browser: String,
      os: String,
      deviceType: {
        type: String,
        enum: ['desktop', 'mobile', 'tablet'],
      },
    },
    location: {
      ip: String,
      country: String,
      city: String,
      region: String,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastActivity: {
      type: Date,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    revokedAt: {
      type: Date,
    },
    purpose: {
      type: String,
      enum: ['session', 'impersonation'],
      default: 'session',
      index: true,
    },
    impersonator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'sessions',
  }
);

// Compound index for efficient queries
SessionSchema.index({ userId: 1, isActive: 1 });
SessionSchema.index({ userId: 1, expiresAt: 1 });

// Auto-cleanup expired sessions (optional, can also be done via cron)
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model<ISession>('Session', SessionSchema);

