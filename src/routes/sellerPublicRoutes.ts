// src/routes/sellerPublicRoutes.ts
// PUBLIC routes for viewing any seller's store page (no auth required)
import express from "express";
import { supabaseAdmin as supabase } from "../config/database";

const router = express.Router();

/**
 * GET /api/sellers/:sellerId/profile
 * Get public seller profile (no auth required)
 */
router.get("/:sellerId/profile", async (req, res) => {
  try {
    const { sellerId } = req.params;

    // Get seller info
    const { data: seller, error: sellerError } = await supabase
      .from("users")
      .select("user_id, name, profile_picture, created_at, kyc_status, trust_score, location_state, location_city")
      .eq("user_id", sellerId)
      .single();

    if (sellerError || !seller) {
      return res.status(404).json({
        success: false,
        error: "Seller not found",
      });
    }

    // Get product count and category breakdown
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select(`
        product_id,
        categories(name)
      `)
      .eq("seller_id", sellerId)
      .eq("status", "active");

    const totalProducts = products?.length || 0;

    // Calculate category breakdown
    const categoryBreakdown: Record<string, number> = {};
    products?.forEach((product) => {
      const catName = (product.categories as any)?.name || "Other";
      categoryBreakdown[catName] = (categoryBreakdown[catName] || 0) + 1;
    });

    // Get seller profile if exists
    const { data: sellerProfile } = await supabase
      .from("seller_profiles")
      .select("store_name, store_logo, store_description")
      .eq("user_id", sellerId)
      .single();

    // Check KYC application for store name
    const { data: kycApp } = await supabase
      .from("kyc_applications")
      .select("store_name")
      .eq("user_id", sellerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Check kyc_documents for store logo
    const { data: storeLogoDoc } = await supabase
      .from("kyc_documents")
      .select("file_url")
      .eq("user_id", sellerId)
      .eq("document_type", "store_logo")
      .single();

    // Prioritize sources
    const storeName = sellerProfile?.store_name || kycApp?.store_name || null;
    const storeLogo = sellerProfile?.store_logo || storeLogoDoc?.file_url || null;

    res.json({
      success: true,
      data: {
        user_id: seller.user_id,
        name: seller.name,
        profile_picture: seller.profile_picture,
        trust_score: seller.trust_score,
        kyc_status: seller.kyc_status,
        member_since: seller.created_at,
        location_state: seller.location_state,
        location_city: seller.location_city,
        store_name: storeName,
        store_logo: storeLogo,
        store_description: sellerProfile?.store_description || null,
        is_verified: seller.kyc_status === "verified",
        total_products: totalProducts,
        category_breakdown: categoryBreakdown,
      },
    });
  } catch (error: any) {
    console.error("❌ Seller profile fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch seller profile",
    });
  }
});

/**
 * GET /api/sellers/:sellerId/products
 * Get seller's products with optional filters (no auth required)
 */
router.get("/:sellerId/products", async (req, res) => {
  try {
    const { sellerId } = req.params;
    const {
      category,
      sort = "newest",
      page = "1",
      limit = "20",
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from("products")
      .select(
        `
        *,
        categories(name, slug),
        product_images(image_url, is_primary, display_order)
      `,
        { count: "exact" }
      )
      .eq("seller_id", sellerId)
      .eq("status", "active");

    // Sort
    switch (sort) {
      case "oldest":
        query = query.order("created_at", { ascending: true });
        break;
      case "price_low":
        query = query.order("price", { ascending: true });
        break;
      case "price_high":
        query = query.order("price", { ascending: false });
        break;
      case "popular":
        query = query.order("views_count", { ascending: false });
        break;
      case "newest":
      default:
        query = query.order("created_at", { ascending: false });
    }

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    // Filter by category name in JS if needed
    let filteredData = data || [];
    if (category && category !== "all") {
      filteredData = filteredData.filter(
        (p) => (p.categories as any)?.name === category
      );
    }

    res.json({
      success: true,
      data: {
        products: filteredData,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          pages: Math.ceil((count || 0) / limitNum),
        },
      },
    });
  } catch (error: any) {
    console.error("❌ Seller products fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch seller products",
    });
  }
});

export default router;