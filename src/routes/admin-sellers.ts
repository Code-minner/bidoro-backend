// src/routes/admin-sellers.ts
import express from "express";
import { Response } from "express";
import { supabaseAdmin as supabase } from "../config/database";
import {
  authenticateToken,
  AuthRequest,
  requireAdmin,
} from "../middleware/auth";

const router = express.Router();

// TODO: Uncomment these when admin login is implemented
// router.use(authenticateToken);
// router.use(requireAdmin);

/**
 * GET /api/admin/sellers
 * Get all approved sellers with pagination, search, and filters
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      location,
      sort = "created_at",
      order = "desc",
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    // Build query for sellers (users with role = 'seller' and kyc_status = 'verified')
    let query = supabase
      .from("users")
      .select(
        `
        user_id,
        name,
        email,
        phone_number,
        role,
        account_status,
        kyc_status,
        location_state,
        location_city,
        created_at
      `,
        { count: "exact" }
      )
      .eq("role", "seller")
      .eq("kyc_status", "verified")
      .order(sort as string, { ascending: order === "asc" })
      .range(offset, offset + Number(limit) - 1);

    // Apply filters
    if (status && status !== "all") {
      query = query.eq("account_status", status);
    }

    if (location) {
      query = query.ilike("location_state", `%${location}%`);
    }

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,phone_number.ilike.%${search}%`
      );
    }

    const { data: sellers, error, count } = await query;

    if (error) {
      console.error("Admin sellers fetch error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch sellers",
        error: error.message,
      });
    }

    // Get product counts for each seller
    const sellerIds = sellers?.map((s) => s.user_id) || [];

    let productCounts: Record<string, number> = {};

    if (sellerIds.length > 0) {
      const { data: products } = await supabase
        .from("products")
        .select("seller_id")
        .in("seller_id", sellerIds);

      if (products) {
        productCounts = products.reduce(
          (acc: Record<string, number>, p: any) => {
            acc[p.seller_id] = (acc[p.seller_id] || 0) + 1;
            return acc;
          },
          {}
        );
      }
    }

    // Format response
    const formattedSellers =
      sellers?.map((seller) => ({
        id: seller.user_id,
        name: seller.name,
        email: seller.email,
        phoneNumber: seller.phone_number,
        status: seller.account_status === "active" ? "Active" : "Suspended",
        location: seller.location_state || "-",
        regDate: new Date(seller.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
        }),
        products: productCounts[seller.user_id] || 0,
      })) || [];

    // Get summary stats
    const { data: allSellers } = await supabase
      .from("users")
      .select("account_status")
      .eq("role", "seller")
      .eq("kyc_status", "verified");

    const summary = {
      total: allSellers?.length || 0,
      active:
        allSellers?.filter((s) => s.account_status === "active").length || 0,
      suspended:
        allSellers?.filter((s) => s.account_status === "suspended").length || 0,
    };

    res.json({
      success: true,
      data: {
        sellers: formattedSellers,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / Number(limit)),
        },
        summary,
      },
    });
  } catch (error) {
    console.error("Admin sellers error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * GET /api/admin/sellers/:id
 * Get single seller details - works for any user with seller role or KYC application
 */
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get user - don't require role = seller initially (they might be in KYC process)
    const { data: user, error } = await supabase
      .from("users")
      .select(
        `
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
        location_area,
        created_at,
        updated_at
      `
      )
      .eq("user_id", id)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get seller profile if exists
    const { data: profile } = await supabase
      .from("seller_profiles")
      .select("*")
      .eq("user_id", id)
      .single();

    // Get product count
    let productCount = 0;
    const { count } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", id);
    productCount = count || 0;

    // Get KYC application details (most recent)
    const { data: kycApplication } = await supabase
      .from("kyc_applications")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Get KYC documents from kyc_documents table (using user_id)
    const { data: kycDocuments } = await supabase
      .from("kyc_documents")
      .select("document_type, file_url, file_name, uploaded_at, file_size")
      .eq("user_id", id);

    console.log("KYC Documents found for user:", id, kycDocuments);

    // Map documents by type for easy lookup
    const documentUrls: Record<
      string,
      { url: string; uploadedAt: string; size: number | null }
    > = {};
    if (kycDocuments) {
      kycDocuments.forEach((doc: any) => {
        documentUrls[doc.document_type] = {
          url: doc.file_url,
          uploadedAt: doc.uploaded_at,
          size: doc.file_size,
        };
      });
    }

    console.log("Document URLs mapped:", documentUrls);

    // Build name - prioritize user.name, fallback to profile or KYC
    const userName =
      user.name ||
      (kycApplication?.first_name && kycApplication?.last_name
        ? `${kycApplication.first_name} ${kycApplication.last_name}`
        : null) ||
      profile?.store_name ||
      "Unknown";

    // Split name into first/last
    const nameParts = userName.split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    // Format documents for frontend - from kyc_documents table
    const formattedDocuments: any[] = [];
    const uploadDate =
      kycApplication?.submitted_at ||
      kycApplication?.created_at ||
      user.created_at;

    if (documentUrls["id_card"]) {
      formattedDocuments.push({
        id: "id_card",
        name: `ID Card (${kycApplication?.identity_type || "National ID"})`,
        type: documentUrls["id_card"].url.toLowerCase().endsWith(".pdf")
          ? "pdf"
          : "image",
        url: documentUrls["id_card"].url,
        size: documentUrls["id_card"].size,
        uploadedAt: documentUrls["id_card"].uploadedAt || uploadDate,
        status: "uploaded",
      });
    }

    if (documentUrls["selfie"]) {
      formattedDocuments.push({
        id: "selfie",
        name: "Personal Photo/Selfie",
        type: "image",
        url: documentUrls["selfie"].url,
        size: documentUrls["selfie"].size,
        uploadedAt: documentUrls["selfie"].uploadedAt || uploadDate,
        status: "uploaded",
      });
    }

    if (documentUrls["business_cert"]) {
      formattedDocuments.push({
        id: "cac",
        name: "Business Certificate (CAC)",
        type: documentUrls["business_cert"].url.toLowerCase().endsWith(".pdf")
          ? "pdf"
          : "image",
        url: documentUrls["business_cert"].url,
        size: documentUrls["business_cert"].size,
        uploadedAt: documentUrls["business_cert"].uploadedAt || uploadDate,
        status: "uploaded",
      });
    }

    if (documentUrls["store_logo"]) {
      formattedDocuments.push({
        id: "store_logo",
        name: "Store Logo",
        type: "image",
        url: documentUrls["store_logo"].url,
        size: documentUrls["store_logo"].size,
        uploadedAt: documentUrls["store_logo"].uploadedAt || uploadDate,
        status: "uploaded",
      });
    }

    res.json({
      success: true,
      data: {
        seller: {
          id: user.user_id,
          firstName: firstName,
          lastName: lastName,
          name: userName,
          email: user.email || "",
          phoneNumber: user.phone_number || "",
          avatar: user.profile_picture,
          countryCode: "+234",
          status:
            user.account_status === "active"
              ? "Active"
              : user.account_status === "suspended"
              ? "Suspended"
              : "Active",
          kycStatus: user.kyc_status || kycApplication?.status || "not_started",
          location: {
            state: user.location_state || kycApplication?.identity_state || "",
            city: user.location_city || "",
            area: user.location_area || kycApplication?.identity_lga || "",
          },
          address: kycApplication?.identity_address || "",
          identityType: kycApplication?.identity_type || "",
          identityNumber: kycApplication?.identity_number || "",
          businessName: kycApplication?.store_name || profile?.store_name || "",
          businessAddress:
            kycApplication?.store_address || profile?.store_address || "",
          businessIdentityNumber:
            kycApplication?.business_id ||
            profile?.business_registration_number ||
            "",
          regDate: user.created_at,
          products: productCount,
        },
        documents: formattedDocuments,
        kycApplication: kycApplication
          ? {
              application_id: kycApplication.application_id,
              status: kycApplication.status,
              identity_type: kycApplication.identity_type,
              identity_number: kycApplication.identity_number,
              identity_state: kycApplication.identity_state,
              identity_lga: kycApplication.identity_lga,
              identity_address: kycApplication.identity_address,
              store_name: kycApplication.store_name,
              store_address: kycApplication.store_address,
              business_id: kycApplication.business_id,
              // Document URLs from kyc_documents table
              identity_document_url: documentUrls["id_card"]?.url || null,
              selfie_url: documentUrls["selfie"]?.url || null,
              business_document_url: documentUrls["business_cert"]?.url || null,
              store_logo_url: documentUrls["store_logo"]?.url || null,
              submitted_at: kycApplication.submitted_at,
              reviewed_at: kycApplication.reviewed_at,
              rejection_reason: kycApplication.rejection_reason,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Admin seller details error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * PUT /api/admin/sellers/:id/suspend
 * Suspend a seller
 */
router.put("/:id/suspend", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Get current seller
    const { data: seller, error: fetchError } = await supabase
      .from("users")
      .select("user_id, name, email, account_status")
      .eq("user_id", id)
      .eq("role", "seller")
      .single();

    if (fetchError || !seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found",
      });
    }

    if (seller.account_status === "suspended") {
      return res.status(400).json({
        success: false,
        message: "Seller is already suspended",
      });
    }

    // Update seller status
    const { error: updateError } = await supabase
      .from("users")
      .update({
        account_status: "suspended",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", id);

    if (updateError) {
      console.error("Suspend error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to suspend seller",
      });
    }

    res.json({
      success: true,
      message: "Seller suspended successfully",
      data: {
        sellerId: id,
        sellerName: seller.name,
        newStatus: "suspended",
      },
    });
  } catch (error) {
    console.error("Admin suspend error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * PUT /api/admin/sellers/:id/unsuspend
 * Reactivate a suspended seller
 */
router.put("/:id/unsuspend", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get current seller
    const { data: seller, error: fetchError } = await supabase
      .from("users")
      .select("user_id, name, email, account_status")
      .eq("user_id", id)
      .eq("role", "seller")
      .single();

    if (fetchError || !seller) {
      return res.status(404).json({
        success: false,
        message: "Seller not found",
      });
    }

    if (seller.account_status === "active") {
      return res.status(400).json({
        success: false,
        message: "Seller is already active",
      });
    }

    // Update seller status
    const { error: updateError } = await supabase
      .from("users")
      .update({
        account_status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", id);

    if (updateError) {
      console.error("Unsuspend error:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to reactivate seller",
      });
    }

    res.json({
      success: true,
      message: "Seller reactivated successfully",
      data: {
        sellerId: id,
        sellerName: seller.name,
        newStatus: "active",
      },
    });
  } catch (error) {
    console.error("Admin unsuspend error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;
