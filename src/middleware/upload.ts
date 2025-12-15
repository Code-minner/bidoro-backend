// backend/src/middleware/upload.ts
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import { Request } from "express";
import { AuthRequest } from "./auth";

declare module "express-serve-static-core" {
  interface Request {
    filePath?: string;
    user?: any;
  }
}

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Validate Cloudinary config on startup
if (
  !process.env.CLOUDINARY_CLOUD_NAME ||
  !process.env.CLOUDINARY_API_KEY ||
  !process.env.CLOUDINARY_API_SECRET
) {
  console.warn(
    "⚠️  Cloudinary credentials not configured in environment variables"
  );
}

// Use memory storage (files temporarily stored in RAM)
const storage = multer.memoryStorage();

// File filter for security
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "application/pdf",
    "video/mp4",
    "video/quicktime",
    "video/x-msvideo",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only JPEG, PNG, WebP and PDF files are allowed."
      )
    );
  }
};

// File size limits
const fileLimits = {
  fileSize: 15 * 1024 * 1024, // 10MB max
};

// Base multer upload
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: fileLimits,
});

/**
 * Custom middleware that uploads to Cloudinary after multer processes file
 * ✅ NOW SUPPORTS FLEXIBLE FIELD NAMES (document, image, etc.)
 */
export const uploadMiddleware = {
  single: (fieldName: string = "document") => {
    // ✅ DEFAULT BUT FLEXIBLE
    return async (req: Request, res: any, next: any) => {
      // First, use multer to get the file into memory
      upload.single(fieldName)(req, res, async (err: any) => {
        if (err) {
          return handleUploadError(err, req, res, next);
        }

        const file = req.file;
        if (!file) {
          return next(); // No file uploaded, continue
        }

        try {
          // Get user info and upload type
          const userId = (req as AuthRequest).user?.id || "anonymous";
          const documentType =
            req.body.document_type || req.body.upload_type || "general";

          // ✅ DETERMINE FOLDER BASED ON UPLOAD TYPE
          let folder = "bidoro/general";
          if (
            documentType.includes("kyc") ||
            documentType === "id_card" ||
            documentType === "selfie" ||
            documentType === "business"
          ) {
            folder = `bidoro/kyc/${documentType}`;
          } else if (documentType === "product" || fieldName === "image") {
            folder = "bidoro/products";
          } else {
            folder = `bidoro/kyc/${documentType}`;
          }

          // Generate unique filename
          const timestamp = Date.now();
          const randomString = Math.round(Math.random() * 1e9);
          const baseName = file.originalname
            .split(".")[0]
            .replace(/[^a-zA-Z0-9]/g, "_")
            .substring(0, 30);

          const publicId = `${userId}_${baseName}_${timestamp}_${randomString}`;

          console.log(`📤 Uploading to Cloudinary: ${folder}/${publicId}`);

          // Upload buffer to Cloudinary using streamifier
          const result = await new Promise<any>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              {
                folder: folder,
                public_id: publicId,
                resource_type: file.mimetype.startsWith("video/")
                  ? "video" // ✅ Check video FIRST
                  : file.mimetype.includes("pdf")
                  ? "raw" // ✅ Then check PDF
                  : "image", // ✅ Default to image
                timeout: 60000, // ✅ 60 seconds timeout
                transformation: file.mimetype.startsWith("image/")
                  ? [
                      { width: 1920, height: 1920, crop: "limit" },
                      { quality: "auto:good" },
                    ]
                  : undefined,
              },
              (error, result) => {
                if (error) {
                  console.error("❌ Cloudinary upload error:", error);
                  reject(error);
                } else {
                  console.log("✅ Uploaded to Cloudinary:", result?.secure_url);
                  resolve(result);
                }
              }
            );

            // Convert buffer to stream and pipe to Cloudinary
            streamifier.createReadStream(file.buffer).pipe(uploadStream);
          });

          // Attach Cloudinary result to req.file
          (req.file as any).path = result.secure_url;
          (req.file as any).cloudinary_public_id = result.public_id;
          (req.file as any).cloudinary_url = result.secure_url;

          next();
        } catch (cloudinaryError: any) {
          console.error("❌ Cloudinary upload failed:", cloudinaryError);
          return res.status(500).json({
            success: false,
            message: "Failed to upload file to cloud storage",
            error: cloudinaryError.message,
          });
        }
      });
    };
  },
};

// Error handler for multer errors
export const handleUploadError = (
  error: any,
  req: Request,
  res: any,
  next: any
) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: "File too large. Maximum size is 10MB.",
      });
    }

    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many files. Upload one file at a time.",
      });
    }

    return res.status(400).json({
      success: false,
      message: `Upload error: ${error.message}`,
    });
  }

  if (error.message.includes("Invalid file type")) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }

  next(error);
};

// Helper function to delete file from Cloudinary
export const deleteUploadedFile = async (
  publicId: string
): Promise<boolean> => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === "ok";
  } catch (error) {
    console.error("Error deleting file from Cloudinary:", error);
    return false;
  }
};

// Helper function to get file URL
export const getFileUrl = (filePathOrPublicId: string): string => {
  if (filePathOrPublicId.startsWith("http")) {
    return filePathOrPublicId;
  }
  return cloudinary.url(filePathOrPublicId);
};

// Helper to extract public_id from Cloudinary URL
export const getPublicIdFromUrl = (url: string): string | null => {
  try {
    const regex = /\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/;
    const match = url.match(regex);
    return match ? match[1] : null;
  } catch (error) {
    console.error("Error extracting public_id:", error);
    return null;
  }
};
