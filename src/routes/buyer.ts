// src/routes/buyer.ts
import express from "express";
import { Response } from "express";
import { supabaseAdmin as supabase } from "../config/database";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Configure Cloudinary (should already be configured, but just in case)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// All routes require authentication
router.use(authenticateToken);

/**
 * GET /api/buyer/profile
 * Get current buyer's profile
 */
router.get("/profile", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    console.log("Buyer profile request - User from token:", req.user);

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
        location_state,
        location_city,
        location_area,
        created_at,
        updated_at
      `)
      .eq("user_id", userId)
      .single();

    if (userError || !user) {
      console.error("User fetch error:", userError);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get delivery addresses if they exist
    const { data: deliveryAddresses } = await supabase
      .from("delivery_addresses")
      .select("*")
      .eq("user_id", userId)
      .order("is_default", { ascending: false });

    // Check if user is also a seller (for role switching)
    const { data: sellerProfile } = await supabase
      .from("seller_profiles")
      .select("id, store_name")
      .eq("user_id", userId)
      .single();

    // Get KYC status if user has applied to be a seller
    const { data: kycApp } = await supabase
      .from("kyc_applications")
      .select("status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    res.json({
      success: true,
      data: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        profile_picture: user.profile_picture,
        role: user.role,
        account_status: user.account_status,
        location_state: user.location_state,
        location_city: user.location_city,
        location_area: user.location_area,
        created_at: user.created_at,
        updated_at: user.updated_at,
        // Delivery addresses
        delivery_addresses: deliveryAddresses || [],
        // Seller info for role switching
        is_seller: user.role === "seller" || !!sellerProfile,
        seller_kyc_status: kycApp?.status || null,
        store_name: sellerProfile?.store_name || null,
      },
    });
  } catch (error: any) {
    console.error("Get buyer profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch profile",
    });
  }
});

/**
 * PATCH /api/buyer/profile
 * Update current buyer's profile
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
      location_state,
      location_city,
      location_area,
    } = req.body;

    // Build update object
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updates.name = name;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (location_state !== undefined) updates.location_state = location_state;
    if (location_city !== undefined) updates.location_city = location_city;
    if (location_area !== undefined) updates.location_area = location_area;

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("Update error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update profile",
      });
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      data,
    });
  } catch (error: any) {
    console.error("Update buyer profile error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update profile",
    });
  }
});

/**
 * POST /api/buyer/profile/picture
 * Upload profile picture
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
 * GET /api/buyer/addresses
 * Get all delivery addresses
 */
router.get("/addresses", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { data, error } = await supabase
      .from("delivery_addresses")
      .select("*")
      .eq("user_id", userId)
      .order("is_default", { ascending: false });

    if (error) {
      console.error("Fetch addresses error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch addresses",
      });
    }

    res.json({
      success: true,
      data: data || [],
    });
  } catch (error: any) {
    console.error("Get addresses error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch addresses",
    });
  }
});

/**
 * POST /api/buyer/addresses
 * Add new delivery address
 */
router.post("/addresses", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      label,
      recipient_name,
      phone_number,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      is_default,
    } = req.body;

    // If this is set as default, unset other defaults
    if (is_default) {
      await supabase
        .from("delivery_addresses")
        .update({ is_default: false })
        .eq("user_id", userId);
    }

    const { data, error } = await supabase
      .from("delivery_addresses")
      .insert({
        user_id: userId,
        label: label || "Home",
        recipient_name,
        phone_number,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        is_default: is_default || false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Insert address error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to add address",
      });
    }

    res.json({
      success: true,
      message: "Address added successfully",
      data,
    });
  } catch (error: any) {
    console.error("Add address error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to add address",
    });
  }
});

/**
 * PATCH /api/buyer/addresses/:id
 * Update delivery address
 */
router.patch("/addresses/:id", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const addressId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const {
      label,
      recipient_name,
      phone_number,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      is_default,
    } = req.body;

    // If this is set as default, unset other defaults
    if (is_default) {
      await supabase
        .from("delivery_addresses")
        .update({ is_default: false })
        .eq("user_id", userId);
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (label !== undefined) updates.label = label;
    if (recipient_name !== undefined) updates.recipient_name = recipient_name;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (address_line1 !== undefined) updates.address_line1 = address_line1;
    if (address_line2 !== undefined) updates.address_line2 = address_line2;
    if (city !== undefined) updates.city = city;
    if (state !== undefined) updates.state = state;
    if (postal_code !== undefined) updates.postal_code = postal_code;
    if (is_default !== undefined) updates.is_default = is_default;

    const { data, error } = await supabase
      .from("delivery_addresses")
      .update(updates)
      .eq("id", addressId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("Update address error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update address",
      });
    }

    res.json({
      success: true,
      message: "Address updated successfully",
      data,
    });
  } catch (error: any) {
    console.error("Update address error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update address",
    });
  }
});

/**
 * DELETE /api/buyer/addresses/:id
 * Delete delivery address
 */
router.delete("/addresses/:id", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const addressId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { error } = await supabase
      .from("delivery_addresses")
      .delete()
      .eq("id", addressId)
      .eq("user_id", userId);

    if (error) {
      console.error("Delete address error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete address",
      });
    }

    res.json({
      success: true,
      message: "Address deleted successfully",
    });
  } catch (error: any) {
    console.error("Delete address error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to delete address",
    });
  }
});

/**
 * POST /api/buyer/switch-to-seller
 * Check if user can switch to seller mode
 */
router.post("/switch-to-seller", async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Check user's current role and KYC status
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("role, kyc_status")
      .eq("user_id", userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user has completed seller KYC
    const { data: kycApp } = await supabase
      .from("kyc_applications")
      .select("status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const kycStatus = kycApp?.status || user.kyc_status || "not_submitted";

    if (kycStatus === "verified") {
      // User is a verified seller, can switch
      res.json({
        success: true,
        canSwitch: true,
        redirectTo: "/seller/dashboard",
        message: "Redirecting to seller dashboard",
      });
    } else if (kycStatus === "pending") {
      // KYC is pending
      res.json({
        success: true,
        canSwitch: false,
        redirectTo: "/seller-kyc/pending",
        message: "Your seller application is pending review",
      });
    } else {
      // User needs to complete KYC
      res.json({
        success: true,
        canSwitch: false,
        redirectTo: "/seller-kyc",
        message: "Complete seller verification to access seller features",
      });
    }
  } catch (error: any) {
    console.error("Switch to seller error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to check seller status",
    });
  }
});

export default router;