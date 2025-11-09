import mongoose, { Schema, Document } from 'mongoose';

export interface IFormSubmission extends Document {
  form: mongoose.Types.ObjectId;
  data: Record<string, any>;
  userIp?: string;
  userAgent?: string;
  status: 'new' | 'read' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

const FormSubmissionSchema: Schema = new Schema(
  {
    form: {
      type: Schema.Types.ObjectId,
      ref: 'Form',
      required: true,
    },
    data: {
      type: Schema.Types.Mixed,
      required: true,
    },
    userIp: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    status: {
      type: String,
      enum: ['new', 'read', 'archived'],
      default: 'new',
    },
  },
  {
    timestamps: true,
    collection: 'formsubmissions', // Explicitly set collection name
  }
);

// Indexes
FormSubmissionSchema.index({ form: 1 });
FormSubmissionSchema.index({ status: 1 });
FormSubmissionSchema.index({ createdAt: -1 });

export const FormSubmission = mongoose.model<IFormSubmission>('FormSubmission', FormSubmissionSchema);
export { FormSubmissionSchema };
export default FormSubmission;

