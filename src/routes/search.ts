// src/routes/search.ts

import { Router, Response, Request } from "express";
import { supabaseAdmin as supabase } from "../config/database";

const router = Router();

/**
 * GET /api/search
 * Search products only
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const { q, category, location, limit = 20, page = 1 } = req.query;

    if (!q || String(q).trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters",
      });
    }

    const searchQuery = String(q).trim();
    const offset = (Number(page) - 1) * Number(limit);

    // Find matching categories
    const { data: matchingCategories } = await supabase
      .from("categories")
      .select("category_id")
      .ilike("name", `%${searchQuery}%`);

    const matchingCategoryIds = matchingCategories?.map(c => c.category_id) || [];

    // Build search query
    let productQuery = supabase
      .from("products")
      .select(`
        product_id,
        name,
        slug,
        price,
        location_city,
        location_state,
        negotiable,
        receipt_verified,
        shipping_available,
        pickup_available,
        created_at,
        category_id,
        seller_id
      `, { count: "exact" })
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    // Search by name, description, OR category
    if (matchingCategoryIds.length > 0) {
      productQuery = productQuery.or(
        `name.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%,category_id.in.(${matchingCategoryIds.join(",")})`
      );
    } else {
      productQuery = productQuery.or(
        `name.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`
      );
    }

    const { data: products, error, count } = await productQuery;

    if (error) {
      console.error("Product search error:", error);
      return res.status(500).json({
        success: false,
        message: "Search failed",
      });
    }

    let mappedProducts: any[] = [];

    if (products && products.length > 0) {
      // Get images
      const productIds = products.map(p => p.product_id);
      const { data: images } = await supabase
        .from("product_images")
        .select("product_id, image_url, is_primary")
        .in("product_id", productIds);

      // Get categories
      const categoryIds = [...new Set(products.map(p => p.category_id).filter(Boolean))];
      let categories: any[] = [];
      if (categoryIds.length > 0) {
        const { data } = await supabase
          .from("categories")
          .select("category_id, name, slug")
          .in("category_id", categoryIds);
        categories = data || [];
      }

      // Get sellers
      const sellerIds = [...new Set(products.map(p => p.seller_id).filter(Boolean))];
      let sellers: any[] = [];
      if (sellerIds.length > 0) {
        const { data } = await supabase
          .from("users")
          .select("user_id, name, profile_picture")
          .in("user_id", sellerIds);
        sellers = data || [];
      }

      // Map results
      mappedProducts = products.map((p: any) => {
        const productImages = images?.filter(img => img.product_id === p.product_id) || [];
        const primaryImage = productImages.find(img => img.is_primary) || productImages[0];
        const category = categories?.find(c => c.category_id === p.category_id);
        const seller = sellers?.find(s => s.user_id === p.seller_id);

        return {
          productId: p.product_id,
          name: p.name,
          slug: p.slug,
          price: p.price,
          location: [p.location_city, p.location_state].filter(Boolean).join(", ") || "Nigeria",
          negotiable: p.negotiable,
          verified: p.receipt_verified,
          shippingAvailable: p.shipping_available,
          pickupAvailable: p.pickup_available,
          imageUrl: primaryImage?.image_url || "/assets/product.png",
          category: category?.name || "Uncategorized",
          categorySlug: category?.slug || "products",
          sellerName: seller?.name || "Seller",
        };
      });
    }

    res.json({
      success: true,
      data: {
        products: mappedProducts,
        totalProducts: count || 0,
      },
      meta: {
        query: q,
        page: Number(page),
        limit: Number(limit),
        totalProducts: count || 0,
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({
      success: false,
      message: "Search failed",
    });
  }
});

/**
 * GET /api/search/suggestions
 * Get search suggestions (products and categories only)
 */
router.get("/suggestions", async (req: Request, res: Response) => {
  try {
    const { q } = req.query;

    if (!q || String(q).trim().length < 2) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const searchQuery = String(q).trim();

    // Get product name suggestions
    const { data: products } = await supabase
      .from("products")
      .select("name")
      .eq("status", "active")
      .ilike("name", `%${searchQuery}%`)
      .limit(5);

    // Get category suggestions
    const { data: categories } = await supabase
      .from("categories")
      .select("name")
      .ilike("name", `%${searchQuery}%`)
      .limit(3);

    const suggestions = [
      ...(products?.map((p) => ({ type: "product", text: p.name })) || []),
      ...(categories?.map((c) => ({ type: "category", text: c.name })) || []),
    ];

    res.json({
      success: true,
      data: suggestions,
    });
  } catch (error) {
    console.error("Suggestions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get suggestions",
    });
  }
});

/**
 * GET /api/search/trending
 * Get trending searches
 */
router.get("/trending", async (req: Request, res: Response) => {
  try {
    const trending = [
      "iPhone",
      "PlayStation 5",
      "MacBook",
      "Samsung TV",
      "Toyota Camry",
      "Air Conditioner",
      "Generator",
      "Laptop",
    ];

    res.json({
      success: true,
      data: {
        trending,
      },
    });
  } catch (error) {
    console.error("Trending error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get trending",
    });
  }
});

export default router;