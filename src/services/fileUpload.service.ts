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

// Multer upload configuration
export const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'application/pdf',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF are allowed.'));
    }
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

