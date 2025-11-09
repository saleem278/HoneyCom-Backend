import mongoose, { Schema, Document } from 'mongoose';

export interface IContentEditor extends Document {
  user: mongoose.Types.ObjectId;
  permissions: {
    pages: boolean;
    blog: boolean;
    media: boolean;
    menu: boolean;
    forms: boolean;
    seo: boolean;
  };
  contentAreas: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ContentEditorSchema: Schema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    permissions: {
      pages: {
        type: Boolean,
        default: true,
      },
      blog: {
        type: Boolean,
        default: true,
      },
      media: {
        type: Boolean,
        default: true,
      },
      menu: {
        type: Boolean,
        default: false,
      },
      forms: {
        type: Boolean,
        default: false,
      },
      seo: {
        type: Boolean,
        default: true,
      },
    },
    contentAreas: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'contenteditors', // Explicitly set collection name
  }
);

// Index
ContentEditorSchema.index({ user: 1 });

export default mongoose.model<IContentEditor>('ContentEditor', ContentEditorSchema);

