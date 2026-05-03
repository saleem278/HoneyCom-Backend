import multer from 'multer';
import type { Request } from 'express';
import { v2 as cloudinary } from 'cloudinary';
// multer-storage-cloudinary ships no types — quietly silence the import.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type defs published.
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import dotenv from 'dotenv';

dotenv.config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure storage. `req`/`file` are unused but the signature must match what
// multer-storage-cloudinary expects.
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (_req: Request, _file: Express.Multer.File) => {
    return {
      folder: 'honey-ecommerce',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'pdf'],
      transformation: [{ width: 1000, height: 1000, crop: 'limit' }],
    };
  },
});

// Multer upload configuration.
//
// fileFilter sanity-checks both the claimed MIME type AND the file extension.
// `mimetype` alone is client-supplied and trivial to spoof, so we cross-check
// the extension. The *real* security boundary is Cloudinary's `allowed_formats`
// (params above), which sniffs the actual file bytes server-side. This filter
// is a fast first-line that rejects obviously bogus uploads before they reach
// Cloudinary and use bandwidth.
const ALLOWED_TYPES: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
};

export const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ALLOWED_TYPES[file.mimetype];
    if (!allowedExtensions) {
      return cb(
        new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF are allowed.'),
      );
    }
    const lowerName = (file.originalname || '').toLowerCase();
    const extensionMatches = allowedExtensions.some((ext) => lowerName.endsWith(ext));
    if (!extensionMatches) {
      // MIME header says image but filename doesn't end in an image extension —
      // typical sign of a renamed/spoofed upload. Reject early.
      return cb(
        new Error('File extension does not match its declared type.'),
      );
    }
    cb(null, true);
  },
});

// Upload single file
export const uploadSingle = upload.single('file');

// Upload multiple files
export const uploadMultiple = upload.array('files', 10);

// Delete file from Cloudinary
export const deleteFile = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    // Error deleting file
    throw error;
  }
};

// Get file URL from Cloudinary public ID
export const getFileUrl = (publicId: string): string => {
  return cloudinary.url(publicId);
};

