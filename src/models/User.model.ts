import mongoose, { Schema, Document } from 'mongoose';

export const USER_ROLES = ['customer', 'seller', 'admin', 'superadmin', 'contentEditor'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** PAY-01: Saved payout destination for sellers */
export interface IPayoutMethod {
  _id: mongoose.Types.ObjectId;
  label?: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
  ifscCode?: string;
  swiftCode?: string;
  upiId?: string;
  isDefault?: boolean;
}

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
  /** PAY-01: Saved seller payout destinations (bank/UPI) */
  payoutMethods?: IPayoutMethod[];
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
    approvalStatus?: 'pending' | 'approved' | 'rejected' | 'info_requested';
    submittedAt?: Date;
    rejectionReason?: string;
    reviewNotes?: string;
    reviewedAt?: Date;
    reviewedBy?: mongoose.Types.ObjectId;
  };
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator: function(value: string | undefined) {
          if (!value || value.trim() === '') return true;
          return value.trim().length >= 2;
        },
        message: 'Name must be at least 2 characters if provided',
      },
    },
    email: {
      type: String,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: function() { return this.isNew || this.isModified('password'); },
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,
    },
    phone: { type: String, trim: true },
    role: { type: String, enum: USER_ROLES, default: 'customer' },
    status: { type: String, enum: ['active', 'inactive', 'suspended'], default: 'active' },
    avatar: { type: String },
    addresses: [{ type: Schema.Types.ObjectId, ref: 'Address' }],
    paymentMethods: [{ type: Schema.Types.ObjectId, ref: 'PaymentMethod' }],
    /** PAY-01: Saved payout destinations for sellers */
    payoutMethods: [
      {
        label: { type: String, trim: true },
        bankAccountName: { type: String, trim: true, required: true },
        bankAccountNumber: { type: String, trim: true, required: true },
        bankName: { type: String, trim: true, required: true },
        ifscCode: { type: String, trim: true },
        swiftCode: { type: String, trim: true },
        upiId: { type: String, trim: true },
        isDefault: { type: Boolean, default: false },
      },
    ],
    walletBalance: { type: Number, default: 0, min: [0, 'Wallet balance cannot be negative'] },
    loyaltyPoints: { type: Number, default: 0, min: [0, 'Loyalty points cannot be negative'] },
    referralCode: { type: String, sparse: true, index: true },
    referralCodeUsed: { type: String },
    referralStats: { usedCount: { type: Number, default: 0 }, bonusEarned: { type: Number, default: 0 } },
    wishlist: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
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
      secret: { type: String, select: false },
      pendingSecret: { type: String, select: false },
      recoveryCodes: { type: [String], select: false, default: undefined },
      activatedAt: Date,
    },
    socialLogin: { provider: String, providerId: String },
    sellerInfo: {
      businessName: String,
      businessAddress: String,
      taxId: String,
      documents: { businessLicense: String, taxDocument: String, idDocument: String },
      approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'info_requested'], default: 'pending' },
      submittedAt: Date,
      rejectionReason: String,
      reviewNotes: String,
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    lastLogin: { type: Date },
  },
  {
    timestamps: true,
    collection: 'users',
    strictPopulate: false,
    validateBeforeSave: true,
  } as any
);

UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });

export const User = mongoose.model<IUser>('User', UserSchema);
export { UserSchema };
