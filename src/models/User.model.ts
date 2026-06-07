import mongoose, { Schema, Document } from 'mongoose';

// Single source of truth for the user role string. Both the Mongoose enum and
// the IUser type reference this so they cannot drift. Clients (mobile + web)
// must use these exact strings — note that the CMS role is 'contentEditor'
// (camelCase), not 'content_editor' or 'cms'.
// superadmin has all admin powers plus: manage other admins, access all settings,
// and cannot be locked out. Only 1 superadmin should exist per installation.
export const USER_ROLES = ['customer', 'seller', 'admin', 'superadmin', 'contentEditor'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface IUser extends Document {
  name: string;
  email?: string;
  password: string;
  phone?: string;
  role: UserRole;
  status: 'active' | 'inactive' | 'suspended';
  avatar?: string;
  addresses: mongoose.Types.ObjectId[];
  paymentMethods: mongoose.Types.ObjectId[];
  walletBalance: number;
  loyaltyPoints: number;
  referralCode?: string;
  referralCodeUsed?: string;
  referralStats?: { usedCount: number; bonusEarned: number };
  wishlist?: mongoose.Types.ObjectId[];
  emailVerified: boolean;
  phoneVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationExpire?: Date;
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
  phoneLoginOtp?: string;
  phoneLoginOtpExpire?: Date;
  phoneLoginOtpAttempts?: number;
  phoneLoginOtpLockedUntil?: Date;
  // TOTP-based 2FA. `pendingSecret` is the secret created during setup but
  // not yet activated — it only flips into `secret` (and `enabled` -> true)
  // when the user successfully verifies a code, proving they actually
  // scanned the QR. Recovery codes are hashed so they can't be read from
  // a stolen DB dump.
  twoFactor?: {
    enabled?: boolean;
    secret?: string;
    pendingSecret?: string;
    recoveryCodes?: string[];
    activatedAt?: Date;
  };
  socialLogin?: {
    provider: string;
    providerId: string;
  };
  sellerInfo?: {
    businessName?: string;
    businessAddress?: string;
    taxId?: string;
    documents?: {
      businessLicense?: string;
      taxDocument?: string;
      idDocument?: string;
    };
    approvalStatus?: 'pending' | 'approved' | 'rejected';
    submittedAt?: Date;
  };
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: false, // Modern e-commerce: name is optional, progressive profiling
      trim: true,
      validate: {
        validator: function(value: string | undefined) {
          // Only validate if name is provided
          if (!value || value.trim() === '') {
            return true; // Empty name is allowed
          }
          return value.trim().length >= 2; // If provided, must be at least 2 characters
        },
        message: 'Name must be at least 2 characters if provided',
      },
    },
    email: {
      type: String,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        'Please provide a valid email',
      ],
    },
    password: {
      type: String,
      required: function() {
        // Only require password when creating new documents, not during populate
        return this.isNew || this.isModified('password');
      },
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    phone: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'customer',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
    },
    avatar: {
      type: String,
    },
    addresses: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Address',
      },
    ],
    paymentMethods: [
      {
        type: Schema.Types.ObjectId,
        ref: 'PaymentMethod',
      },
    ],
    walletBalance: {
      type: Number,
      default: 0,
      min: [0, 'Wallet balance cannot be negative'],
    },
    loyaltyPoints: {
      type: Number,
      default: 0,
      min: [0, 'Loyalty points cannot be negative'],
    },
    referralCode: { type: String, sparse: true, index: true },
    referralCodeUsed: { type: String },
    referralStats: {
      usedCount: { type: Number, default: 0 },
      bonusEarned: { type: Number, default: 0 },
    },
    wishlist: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    emailVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: String,
    emailVerificationExpire: Date,
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    phoneLoginOtp: String,
    phoneLoginOtpExpire: Date,
    phoneLoginOtpAttempts: { type: Number, default: 0 },
    phoneLoginOtpLockedUntil: Date,
    twoFactor: {
      enabled: { type: Boolean, default: false },
      // The active secret is `select: false` so it doesn't leak into
      // ordinary `findById(...)` calls — must be explicitly selected by
      // the verify path.
      secret: { type: String, select: false },
      pendingSecret: { type: String, select: false },
      // Recovery codes stored as bcrypt hashes; they get cleared as the
      // user consumes them.
      recoveryCodes: { type: [String], select: false, default: undefined },
      activatedAt: Date,
    },
    socialLogin: {
      provider: String,
      providerId: String,
    },
    sellerInfo: {
      businessName: String,
      businessAddress: String,
      taxId: String,
      documents: {
        businessLicense: String,
        taxDocument: String,
        idDocument: String,
      },
      approvalStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
      },
      submittedAt: Date,
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'users', // Explicitly set collection name
    strictPopulate: false, // Allow populating even if fields aren't strictly defined
    validateBeforeSave: true, // Only validate when saving, not when populating
  } as any
);

// Unique indexes for email and phone when present
// Note: existing deployments should drop the old { email: 1 } unique index manually.
UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });

export const User = mongoose.model<IUser>('User', UserSchema);
export { UserSchema };

