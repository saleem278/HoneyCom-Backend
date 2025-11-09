import mongoose, { Schema, Document } from 'mongoose';

export interface IFormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'number' | 'date' | 'file';
  required: boolean;
  placeholder?: string;
  options?: string[];
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
  order: number;
}

export interface IForm extends Document {
  name: string;
  description?: string;
  fields: IFormField[];
  submitButtonText: string;
  successMessage: string;
  redirectUrl?: string;
  emailNotification?: boolean;
  emailRecipients?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const FormFieldSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['text', 'email', 'textarea', 'select', 'checkbox', 'radio', 'number', 'date', 'file'],
      required: true,
    },
    required: {
      type: Boolean,
      default: false,
    },
    placeholder: {
      type: String,
    },
    options: {
      type: [String],
      default: [],
    },
    validation: {
      min: Number,
      max: Number,
      pattern: String,
      message: String,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const FormSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a form name'],
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      maxlength: [500, 'Description must be less than 500 characters'],
    },
    fields: {
      type: [FormFieldSchema],
      required: true,
      validate: {
        validator: (fields: IFormField[]) => fields.length > 0,
        message: 'Form must have at least one field',
      },
    },
    submitButtonText: {
      type: String,
      default: 'Submit',
      trim: true,
    },
    successMessage: {
      type: String,
      default: 'Thank you for your submission!',
      trim: true,
    },
    redirectUrl: {
      type: String,
    },
    emailNotification: {
      type: Boolean,
      default: false,
    },
    emailRecipients: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'forms', // Explicitly set collection name
  }
);

export const Form = mongoose.model<IForm>('Form', FormSchema);
export { FormSchema };

