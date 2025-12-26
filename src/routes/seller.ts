// src/routes/seller.ts
import express from "express";
import { Response } from "express";
import { supabaseAdmin as supabase } from "../config/database";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/seller/profile
 * Get current seller's profile with KYC data
 */
router.get("/profile", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    console.log("Profile request - User from token:", req.user);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Get user data
    const { data: user, error: userError } = await supabase
      .from("users")
      .select(`
        user_id,
        name,
        email,
        phone_number,
        profile_picture,
        role,
        account_status,
        kyc_status,
        location_state,
        location_city,
        created_at,
        updated_at
      `)
      .eq("user_id", userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get KYC application data (most recent)
    const { data: kycApp } = await supabase
      .from("kyc_applications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Get KYC documents from kyc_documents table
    const { data: kycDocuments } = await supabase
      .from("kyc_documents")
      .select("document_type, file_url")
      .eq("user_id", userId);

    console.log("KYC Documents:", kycDocuments);

    // Map documents by type
    const documentUrls: Record<string, string> = {};
    if (kycDocuments) {
      kycDocuments.forEach((doc: { document_type: string; file_url: string }) => {
        documentUrls[doc.document_type] = doc.file_url;
      });
    }
    console.log("Document URLs mapped:", documentUrls);

    // Get seller profile if exists
    const { data: sellerProfile } = await supabase
      .from("seller_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();

    res.json({
      success: true,
      data: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        profile_picture: user.profile_picture,
        account_status: user.account_status,
        kyc_status: user.kyc_status || kycApp?.status || "not_started",
        location_state: user.location_state,
        location_city: user.location_city,
        created_at: user.created_at,
        // KYC data
        identity_type: kycApp?.identity_type || null,
        identity_number: kycApp?.identity_number || null,
        identity_state: kycApp?.identity_state || null,
        identity_lga: kycApp?.identity_lga || null,
        identity_address: kycApp?.identity_address || null,
        business_name: kycApp?.store_name || sellerProfile?.store_name || null,
        business_address: kycApp?.store_address || sellerProfile?.store_address || null,
        business_registration_number: kycApp?.business_id || null,
        // Document URLs from kyc_documents table
        identity_document_url: documentUrls['id_card'] || null,
        selfie_url: documentUrls['selfie'] || null,
        business_document_url: documentUrls['business_cert'] || null,
        store_logo_url: documentUrls['store_logo'] || null,
      },
    });
  } catch (error: any) {
    console.error("Get seller profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch profile",
    });
  }
});

/**
 * PATCH /api/seller/profile
 * Update current seller's profile
 */
router.patch("/profile", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      name,
      phone_number,
      identity_address,
      identity_number,
      business_name,
      business_address,
      business_registration_number,
    } = req.body;

    // Update user table
    const userUpdates: any = {};
    if (name) userUpdates.name = name;
    if (phone_number) userUpdates.phone_number = phone_number;
    userUpdates.updated_at = new Date().toISOString();

    const { error: userError } = await supabase
      .from("users")
      .update(userUpdates)
      .eq("user_id", userId);

    if (userError) {
      console.error("User update error:", userError);
      return res.status(500).json({
        success: false,
        message: "Failed to update user profile",
      });
    }

    // Update KYC application if exists
    const { data: kycApp } = await supabase
      .from("kyc_applications")
      .select("application_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (kycApp) {
      const kycUpdates: any = {
        updated_at: new Date().toISOString(),
      };
      if (identity_address) kycUpdates.identity_address = identity_address;
      if (identity_number) kycUpdates.identity_number = identity_number;
      if (business_name) kycUpdates.store_name = business_name;
      if (business_address) kycUpdates.store_address = business_address;
      if (business_registration_number) kycUpdates.business_id = business_registration_number;

      await supabase
        .from("kyc_applications")
        .update(kycUpdates)
        .eq("application_id", kycApp.application_id);
    }

    // Update seller profile if exists
    const { data: sellerProfile } = await supabase
      .from("seller_profiles")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (sellerProfile && business_name) {
      await supabase
        .from("seller_profiles")
        .update({
          store_name: business_name,
          store_address: business_address,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
    });
  } catch (error: any) {
    console.error("Update seller profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update profile",
    });
  }
});

/**
 * POST /api/seller/profile/picture
 * Upload profile picture to Cloudinary
 */
router.post("/profile/picture", upload.single("profile_picture"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const file = req.file;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    if (!file.mimetype.startsWith("image/")) {
      return res.status(400).json({
        success: false,
        message: "File must be an image",
      });
    }

    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: "File must be less than 5MB",
      });
    }

    // Upload to Cloudinary
    const uploadResult = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "bidoro/profile-pictures",
          public_id: `${userId}_${Date.now()}`,
          resource_type: "image",
          transformation: [
            { width: 400, height: 400, crop: "fill", gravity: "face" },
            { quality: "auto" },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(file.buffer);
    });

    const publicUrl = uploadResult.secure_url;

    console.log("Cloudinary upload result:", publicUrl);

    // Update user profile
    const { error: updateError } = await supabase
      .from("users")
      .update({
        profile_picture: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("Update error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to update profile",
      });
    }

    res.json({
      success: true,
      message: "Profile picture updated",
      data: {
        url: publicUrl,
      },
    });
  } catch (error: any) {
    console.error("Upload profile picture error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to upload picture",
    });
  }
});

/**
 * POST /api/seller/profile/logo
 * Upload store logo to Cloudinary
 */
router.post("/profile/logo", upload.single("store_logo"), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const file = req.file;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    if (!file.mimetype.startsWith("image/")) {
      return res.status(400).json({
        success: false,
        message: "File must be an image",
      });
    }

    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: "File must be less than 5MB",
      });
    }

    // Upload to Cloudinary
    const uploadResult = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "bidoro/store-logos",
          public_id: `${userId}_${Date.now()}`,
          resource_type: "image",
          transformation: [
            { width: 400, height: 400, crop: "fill" },
            { quality: "auto" },
          ],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(file.buffer);
    });

    const publicUrl = uploadResult.secure_url;

    console.log("Store logo upload result:", publicUrl);

    // Check if store_logo document already exists
    const { data: existingDoc } = await supabase
      .from("kyc_documents")
      .select("id")
      .eq("user_id", userId)
      .eq("document_type", "store_logo")
      .single();

    if (existingDoc) {
      // Update existing document
      const { error: updateError } = await supabase
        .from("kyc_documents")
        .update({
          file_url: publicUrl,
          file_name: file.originalname,
          file_size: file.size,
          uploaded_at: new Date().toISOString(),
        })
        .eq("id", existingDoc.id);

      if (updateError) {
        console.error("Update store logo error:", updateError);
        return res.status(500).json({
          success: false,
          message: "Failed to update store logo",
        });
      }
    } else {
      // Insert new document
      const { error: insertError } = await supabase
        .from("kyc_documents")
        .insert({
          user_id: userId,
          document_type: "store_logo",
          file_url: publicUrl,
          file_name: file.originalname,
          file_size: file.size,
          uploaded_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error("Insert store logo error:", insertError);
        return res.status(500).json({
          success: false,
          message: "Failed to save store logo",
        });
      }
    }

    res.json({
      success: true,
      message: "Store logo updated",
      data: {
        url: publicUrl,
      },
    });
  } catch (error: any) {
    console.error("Upload store logo error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to upload logo",
    });
  }
});

export default router;