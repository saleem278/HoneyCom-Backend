import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: 'customer' | 'seller' | 'admin';
  status: 'active' | 'inactive' | 'suspended';
  avatar?: string;
  addresses: mongoose.Types.ObjectId[];
  paymentMethods: mongoose.Types.ObjectId[];
  wishlist?: mongoose.Types.ObjectId[];
  emailVerified: boolean;
  phoneVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationExpire?: Date;
  resetPasswordToken?: string;
  resetPasswordExpire?: Date;
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
      required: [true, 'Please provide a name'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
    },
    email: {
      type: String,
      required: [true, 'Please provide an email'],
      unique: true,
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
      enum: ['customer', 'seller', 'admin', 'contentEditor'],
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

export const User = mongoose.model<IUser>('User', UserSchema);
export { UserSchema };

