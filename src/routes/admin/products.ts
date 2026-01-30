// src/routes/admin/products.ts
// Admin API routes for product management

import express from "express";
import { supabaseAdmin as supabase } from "../../config/database";
import {
  authenticateToken,
  AuthRequest,
  requireAdmin,
} from "../../middleware/auth";

const router = express.Router();

// ============================================================
// ADMIN PRODUCT ROUTES
// All routes require admin authentication
// ============================================================

/**
 * GET /api/admin/products
 * Get all products with filters for admin dashboard
 */
router.get(
  "/",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const {
        status,
        category,
        search,
        page = "1",
        limit = "20",
        sortBy = "created_at",
        sortOrder = "desc",
        verificationStatus,
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      // Build query
      let query = supabase.from("products").select(
        `
        *,
        categories(category_id, name, slug),
        product_images(image_url, is_primary),
        users!products_seller_id_fkey(user_id, name, email, profile_picture)
      `,
        { count: "exact" },
      );

      // Apply filters
      if (status && status !== "all") {
        query = query.eq("status", status);
      }

      if (verificationStatus) {
        query = query.eq("verification_status", verificationStatus);
      }

      if (category) {
        query = query.eq("category_id", category);
      }

      if (search) {
        query = query.or(
          `name.ilike.%${search}%,description.ilike.%${search}%`,
        );
      }

      // Apply sorting
      query = query.order(sortBy as string, { ascending: sortOrder === "asc" });

      // Apply pagination
      query = query.range(offset, offset + limitNum - 1);

      const { data: products, error, count } = await query;

      if (error) {
        console.error("Query error:", error);
        throw error;
      }

      // Transform data for admin dashboard
      const transformedProducts = (products || []).map((product) => ({
        id: product.product_id,
        name: product.name,
        seller: product.users?.name || "Unknown",
        sellerEmail: product.users?.email,
        sellerProfilePic: product.users?.profile_picture,
        category: product.categories?.name || "Uncategorized",
        price: `₦${parseFloat(product.price)?.toLocaleString() || 0}`,
        priceRaw: product.price,
        status: capitalizeFirst(product.status || "pending"),
        verificationStatus: product.verification_status || "pending",
        date: formatDate(product.created_at),
        dateRaw: product.created_at,
        primaryImage:
          product.product_images?.find((img: any) => img.is_primary)
            ?.image_url ||
          product.product_images?.[0]?.image_url ||
          null,
        slug: product.slug,
        viewsCount: product.views_count || 0,
      }));

      res.json({
        success: true,
        data: transformedProducts,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
      });
    } catch (error: any) {
      console.error("❌ Admin products fetch error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch products",
      });
    }
  },
);

/**
 * GET /api/admin/products/stats
 * Get product statistics for admin dashboard
 */
router.get(
  "/stats",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      // Get all products to count statuses
      const { data: allProducts, error: productsError } = await supabase
        .from("products")
        .select("status, verification_status");

      if (productsError) throw productsError;

      // Count by status
      const statusCounts = {
        all: 0,
        active: 0,
        pending: 0,
        declined: 0,
        suspended: 0,
        draft: 0,
      };

      const verificationCounts = {
        ai_verified: 0,
        manual_verified: 0,
        pending: 0,
      };

      (allProducts || []).forEach((p) => {
        statusCounts.all++;
        const status = p.status as keyof typeof statusCounts;
        if (statusCounts[status] !== undefined) {
          statusCounts[status]++;
        }

        const vStatus = (p.verification_status ||
          "pending") as keyof typeof verificationCounts;
        if (verificationCounts[vStatus] !== undefined) {
          verificationCounts[vStatus]++;
        }
      });

      // Get reported products count (if table exists)
      let reportedCount = 0;
      try {
        const { count } = await supabase
          .from("product_reports")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending");
        reportedCount = count || 0;
      } catch {
        // Table might not exist
      }

      // Get requested products count (if table exists)
      let requestedCount = 0;
      try {
        const { count } = await supabase
          .from("product_requests")
          .select("*", { count: "exact", head: true });
        requestedCount = count || 0;
      } catch {
        // Table might not exist
      }

      res.json({
        success: true,
        data: {
          byStatus: statusCounts,
          byVerification: verificationCounts,
          reported: reportedCount,
          requested: requestedCount,
        },
      });
    } catch (error: any) {
      console.error("❌ Admin stats fetch error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch statistics",
      });
    }
  },
);

/**
 * GET /api/admin/products/pending
 * Get products pending verification
 */
router.get(
  "/pending",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { page = "1", limit = "20" } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const offset = (pageNum - 1) * limitNum;

      const {
        data: products,
        error,
        count,
      } = await supabase
        .from("products")
        .select(
          `
        *,
        categories(category_id, name, slug),
        product_images(image_url, is_primary, display_order),
        users!products_seller_id_fkey(user_id, name, email, profile_picture)
      `,
          { count: "exact" },
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (error) {
        throw error;
      }

      res.json({
        success: true,
        data: products,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
      });
    } catch (error: any) {
      console.error("❌ Pending products fetch error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch pending products",
      });
    }
  },
);

/**
 * GET /api/admin/products/:productId
 * Get single product details for admin
 */
router.get(
  "/:productId",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { productId } = req.params;

      const { data: product, error } = await supabase
        .from("products")
        .select(
          `
        *,
        categories(category_id, name, slug, parent_id),
        product_images(image_id, image_url, is_primary, display_order),
        users!products_seller_id_fkey(
          user_id, name, email, profile_picture, 
          phone_number, trust_score, kyc_status, created_at
        )
      `,
        )
        .eq("product_id", productId)
        .single();

      if (error || !product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Get verifications if table exists
      let verifications: any[] = [];
      try {
        const { data } = await supabase
          .from("product_verifications")
          .select("*")
          .eq("product_id", productId);
        verifications = data || [];
      } catch {
        // Table might not exist
      }

      // Get seller's store info
      let storeInfo = null;
      if (product.seller_id) {
        const { data: kycApp } = await supabase
          .from("kyc_applications")
          .select("store_name, business_type, store_address")
          .eq("user_id", product.seller_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        storeInfo = kycApp;
      }

      // Get parent category if exists
      let parentCategory = null;
      if (product.categories?.parent_id) {
        const { data: parent } = await supabase
          .from("categories")
          .select("category_id, name, slug")
          .eq("category_id", product.categories.parent_id)
          .single();
        parentCategory = parent;
      }

      res.json({
        success: true,
        data: {
          ...product,
          parentCategory,
          storeInfo,
          product_verifications: verifications,
          seller: {
            ...product.users,
            store_name: storeInfo?.store_name,
          },
        },
      });
    } catch (error: any) {
      console.error("❌ Product fetch error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch product",
      });
    }
  },
);

/**
 * POST /api/admin/products/:productId/approve
 * Approve a product
 */
router.post(
  "/:productId/approve",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { productId } = req.params;
      const adminId = req.user!.id;

      const { data: product, error: updateError } = await supabase
        .from("products")
        .update({
          status: "active",
          verification_status: "manual_verified",
          updated_at: new Date().toISOString(),
        })
        .eq("product_id", productId)
        .select("name, seller_id")
        .single();

      if (updateError) {
        throw updateError;
      }

      // Log admin action
      await logAdminAction(adminId, "approve_product", productId, {
        productName: product.name,
      });

      res.json({
        success: true,
        message: "Product approved successfully",
      });
    } catch (error: any) {
      console.error("❌ Product approval error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to approve product",
      });
    }
  },
);

/**
 * POST /api/admin/products/:productId/decline
 * Decline a product with reason
 */
router.post(
  "/:productId/decline",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { productId } = req.params;
      const { reason, details } = req.body;
      const adminId = req.user!.id;

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: "Decline reason is required",
        });
      }

      const { data: product, error: updateError } = await supabase
        .from("products")
        .update({
          status: "declined",
          updated_at: new Date().toISOString(),
        })
        .eq("product_id", productId)
        .select("name, seller_id")
        .single();

      if (updateError) {
        throw updateError;
      }

      // Log admin action with reason
      await logAdminAction(adminId, "decline_product", productId, {
        productName: product.name,
        reason,
        details,
      });

      res.json({
        success: true,
        message: "Product declined successfully",
      });
    } catch (error: any) {
      console.error("❌ Product decline error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to decline product",
      });
    }
  },
);

/**
 * POST /api/admin/products/:productId/suspend
 * Suspend a product
 */
router.post(
  "/:productId/suspend",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { productId } = req.params;
      const { reason, details } = req.body;
      const adminId = req.user!.id;

      if (!reason) {
        return res.status(400).json({
          success: false,
          error: "Suspension reason is required",
        });
      }

      const { data: product, error: updateError } = await supabase
        .from("products")
        .update({
          status: "suspended",
          updated_at: new Date().toISOString(),
        })
        .eq("product_id", productId)
        .select("name, seller_id")
        .single();

      if (updateError) {
        throw updateError;
      }

      // Log admin action
      await logAdminAction(adminId, "suspend_product", productId, {
        productName: product.name,
        reason,
        details,
      });

      res.json({
        success: true,
        message: "Product suspended successfully",
      });
    } catch (error: any) {
      console.error("❌ Product suspension error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to suspend product",
      });
    }
  },
);

/**
 * POST /api/admin/products/:productId/verify-receipt
 * Manually trigger receipt verification (placeholder - requires receiptScannerService)
 */
router.post(
  "/:productId/verify-receipt",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { productId } = req.params;

      // Get product with receipt
      const { data: product, error } = await supabase
        .from("products")
        .select("product_id, name, price, receipt_url")
        .eq("product_id", productId)
        .single();

      if (error || !product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      if (!product.receipt_url) {
        return res.status(400).json({
          success: false,
          error: "Product has no receipt uploaded",
        });
      }

      // TODO: Implement receipt verification when receiptScannerService is added
      // For now, return a placeholder response
      res.status(501).json({
        success: false,
        error:
          "Receipt verification not yet implemented. Please review manually.",
      });
    } catch (error: any) {
      console.error("❌ Receipt verification error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to verify receipt",
      });
    }
  },
);

/**
 * DELETE /api/admin/products/:productId
 * Permanently delete a product (admin only)
 */
router.delete(
  "/:productId",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { productId } = req.params;
      const { reason } = req.body;
      const adminId = req.user!.id;

      // Get product info first
      const { data: product } = await supabase
        .from("products")
        .select("name, seller_id")
        .eq("product_id", productId)
        .single();

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Delete related records
      await supabase
        .from("product_images")
        .delete()
        .eq("product_id", productId);

      // Try to delete from optional tables (won't fail if tables don't exist)
      try {
        await supabase
          .from("product_verifications")
          .delete()
          .eq("product_id", productId);
      } catch {}

      try {
        await supabase.from("reviews").delete().eq("product_id", productId);
      } catch {}

      // Delete product
      const { error: deleteError } = await supabase
        .from("products")
        .delete()
        .eq("product_id", productId);

      if (deleteError) {
        throw deleteError;
      }

      // Log admin action
      await logAdminAction(adminId, "delete_product", productId, {
        productName: product.name,
        reason,
      });

      res.json({
        success: true,
        message: "Product deleted successfully",
      });
    } catch (error: any) {
      console.error("❌ Product delete error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete product",
      });
    }
  },
);

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

async function logAdminAction(
  adminId: string,
  action: string,
  targetId: string,
  details: any,
): Promise<void> {
  try {
    // Try to log to admin_logs table if it exists
    await supabase.from("admin_logs").insert({
      admin_id: adminId,
      action,
      target_type: "product",
      target_id: targetId,
      details,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    // Just log to console if table doesn't exist
    console.log(`[ADMIN LOG] ${action} by ${adminId} on ${targetId}:`, details);
  }
}

/**
 * POST /api/admin/products/:productId/reactivate
 * Reactivate a suspended or declined product
 */
router.post(
  "/:productId/reactivate",
  authenticateToken,
  requireAdmin,
  async (req: AuthRequest, res) => {
    try {
      const { productId } = req.params;
      const adminId = req.user!.id;

      // Get current product status
      const { data: currentProduct, error: fetchError } = await supabase
        .from("products")
        .select("name, status, seller_id")
        .eq("product_id", productId)
        .single();

      if (fetchError || !currentProduct) {
        return res.status(404).json({
          success: false,
          error: "Product not found",
        });
      }

      // Only allow reactivating suspended or declined products
      if (!["suspended", "declined"].includes(currentProduct.status)) {
        return res.status(400).json({
          success: false,
          error: `Cannot reactivate a product with status: ${currentProduct.status}`,
        });
      }

      const { data: product, error: updateError } = await supabase
        .from("products")
        .update({
          status: "active",
          // Don't change verification_status - keep whatever it was
          updated_at: new Date().toISOString(),
        })
        .eq("product_id", productId)
        .select("name, seller_id")
        .single();

      if (updateError) {
        throw updateError;
      }

      // Log admin action
      await logAdminAction(adminId, "reactivate_product", productId, {
        productName: product.name,
        previousStatus: currentProduct.status,
      });

      res.json({
        success: true,
        message: "Product reactivated successfully",
      });
    } catch (error: any) {
      console.error("❌ Product reactivation error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to reactivate product",
      });
    }
  },
);

/**
 * GET /api/admin/products/stats
 * Get product statistics for dashboard and tabs
 */
router.get('/stats', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    // Get all products for counting
    const { data: products, error } = await supabase
      .from('products')
      .select('status, verification_status');

    if (error) throw error;

    // Count by status
    const statusCounts = {
      all: products?.length || 0,
      active: products?.filter(p => p.status === 'active').length || 0,
      pending: products?.filter(p => p.status === 'pending').length || 0,
      declined: products?.filter(p => p.status === 'declined').length || 0,
      suspended: products?.filter(p => p.status === 'suspended').length || 0,
      draft: products?.filter(p => p.status === 'draft').length || 0,
    };

    // Count by verification status
    const verificationCounts = {
      aiVerified: products?.filter(p => p.verification_status === 'ai_verified').length || 0,
      manualVerified: products?.filter(p => p.verification_status === 'manual_verified').length || 0,
      pendingVerification: products?.filter(p => p.verification_status === 'pending').length || 0,
      notRequired: products?.filter(p => p.verification_status === 'not_required').length || 0,
    };

    // Get reported products count (pending reports)
    let reportedCount = 0;
    try {
      const { count } = await supabase
        .from('product_reports')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      reportedCount = count || 0;
    } catch (e) {
      // Table might not exist
    }

    // Get requested products count (not responded)
    let requestedCount = 0;
    try {
      const { count } = await supabase
        .from('product_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'not_responded')
        .eq('is_active', true);
      requestedCount = count || 0;
    } catch (e) {
      // Table might not exist
    }

    res.json({
      success: true,
      data: {
        // Status counts
        ...statusCounts,
        
        // Verification counts
        ...verificationCounts,
        
        // Related counts
        reported: reportedCount,
        requested: requestedCount,
      }
    });

  } catch (error: any) {
    console.error('❌ Product stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product statistics'
    });
  }
});

export default router;
