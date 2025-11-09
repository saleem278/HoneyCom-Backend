import mongoose, { Schema, Document } from 'mongoose';

export interface IMedia extends Document {
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  mimeType: string;
  folderPath?: string;
  altText?: string;
  caption?: string;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MediaSchema: Schema = new Schema(
  {
    fileName: {
      type: String,
      required: [true, 'Please provide a file name'],
      trim: true,
    },
    fileUrl: {
      type: String,
      required: [true, 'Please provide a file URL'],
    },
    fileType: {
      type: String,
      required: true,
      enum: ['image', 'video', 'document', 'other'],
    },
    fileSize: {
      type: Number,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    folderPath: {
      type: String,
      default: '/',
    },
    altText: {
      type: String,
      maxlength: [200, 'Alt text must be less than 200 characters'],
    },
    caption: {
      type: String,
      maxlength: [500, 'Caption must be less than 500 characters'],
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'media', // Explicitly set collection name
  }
);

// Indexes
MediaSchema.index({ fileType: 1 });
MediaSchema.index({ folderPath: 1 });
MediaSchema.index({ uploadedBy: 1 });

export const Media = mongoose.model<IMedia>('Media', MediaSchema);
export { MediaSchema };

