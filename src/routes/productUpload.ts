// backend/src/routes/productUpload.ts
// FIXED - Uses your authenticateToken middleware
import express from 'express';
import { uploadMiddleware } from '../middleware/upload';
import { authenticateToken, AuthRequest } from '../middleware/auth'; // ✅ Your auth

const router = express.Router();

/**
 * POST /api/products/upload-image
 * Upload a single product image to Cloudinary
 * ✅ Uses same auth as KYC routes
 */
router.post(
  '/upload-image',
  authenticateToken, // ✅ Your existing auth middleware
  uploadMiddleware.single('image'), // ✅ Then upload
  async (req: AuthRequest, res) => {
    try {
      console.log('📸 Product image upload request received');
      console.log('👤 User ID:', req.user?.id);

      // User is already authenticated by middleware
      if (!req.file) {
        console.error('❌ No file in request');
        return res.status(400).json({
          success: false,
          error: 'No image file provided'
        });
      }

      // File was already uploaded to Cloudinary by middleware
      const file = req.file as any;

      console.log('✅ Product image uploaded:', file.cloudinary_url);

      // Return Cloudinary URL
      res.json({
        success: true,
        data: {
          file_url: file.cloudinary_url || file.path,
          public_id: file.cloudinary_public_id,
          original_name: file.originalname,
          size: file.size,
          mimetype: file.mimetype
        }
      });

    } catch (error: any) {
      console.error('❌ Product image upload error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload image',
        message: error.message
      });
    }
  }
);

/**
 * DELETE /api/products/delete-image
 * Delete image from Cloudinary
 */
router.delete('/delete-image', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { public_id } = req.body;

    if (!public_id) {
      return res.status(400).json({
        success: false,
        error: 'Public ID required'
      });
    }

    // Delete from Cloudinary
    const { v2: cloudinary } = require('cloudinary');
    const result = await cloudinary.uploader.destroy(public_id);

    if (result.result === 'ok') {
      res.json({
        success: true,
        message: 'Image deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Image not found or already deleted'
      });
    }

  } catch (error: any) {
    console.error('❌ Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete image'
    });
  }
});

export default router;