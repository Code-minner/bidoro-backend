// src/routes/admin-customers.ts
// Admin routes for customer management

import express, { Response } from "express";
import { AuthRequest, authenticateToken, requireAdmin } from "../middleware/auth";
import { supabaseAdmin as supabase } from "../config/database";

const router = express.Router();

// TODO: Uncomment these when admin login is implemented
// router.use(authenticateToken);
// router.use(requireAdmin);

// TEMPORARY: Mock admin user for development
router.use((req: AuthRequest, res, next) => {
  req.user = {
    id: 'dev-admin-id',
    email: 'admin@bidoro.com',
    name: 'Dev Admin',
    role: 'admin',
    account_status: 'active',
    kyc_status: 'verified',
    trust_score: 100
  };
  next();
});

/**
 * GET /api/admin/customers
 * Get all customers (users with role='buyer')
 */
router.get("/customers", async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = "1",
      limit = "10",
      search = "",
      status = "all",
      sort = "created_at",
      order = "desc",
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from("users")
      .select("*", { count: "exact" })
      .eq("role", "buyer"); // Only get buyers (customers)

    // Search filter
    if (search) {
      query = query.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,phone_number.ilike.%${search}%`
      );
    }

    // Status filter
    if (status && status !== "all") {
      query = query.eq("account_status", status);
    }

    // Sorting
    const sortColumn = sort as string;
    const sortOrder = order === "asc" ? true : false;
    query = query.order(sortColumn, { ascending: sortOrder });

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: customers, error, count } = await query;

    if (error) {
      console.error("Fetch customers error:", error);
      throw error;
    }

    // Get order counts for each customer (if orders table exists)
    const customersWithOrders = await Promise.all(
      (customers || []).map(async (customer) => {
        // Try to get order count - handle if table doesn't exist
        let totalOrders = 0;
        try {
          const { count: orderCount } = await supabase
            .from("orders")
            .select("*", { count: "exact", head: true })
            .eq("buyer_id", customer.user_id);
          totalOrders = orderCount || 0;
        } catch {
          // Orders table might not exist yet
          totalOrders = customer.total_purchases || 0;
        }

        return {
          user_id: customer.user_id,
          name: customer.name,
          email: customer.email,
          phone_number: customer.phone_number,
          profile_picture: customer.profile_picture,
          account_status: customer.account_status || "active",
          created_at: customer.created_at,
          last_active: customer.last_active,
          total_purchases: customer.total_purchases || 0,
          total_orders: totalOrders,
          email_verified: customer.email_verified || false,
          location_state: customer.location_state,
          location_city: customer.location_city,
        };
      })
    );

    res.json({
      success: true,
      data: customersWithOrders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error: any) {
    console.error("Get customers error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch customers",
    });
  }
});

/**
 * GET /api/admin/customers/:id
 * Get single customer details
 */
router.get("/customers/:id", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: customer, error } = await supabase
      .from("users")
      .select("*")
      .eq("user_id", id)
      .eq("role", "buyer")
      .single();

    if (error || !customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Get order history
    let orders: any[] = [];
    try {
      const { data: orderData } = await supabase
        .from("orders")
        .select("*")
        .eq("buyer_id", id)
        .order("created_at", { ascending: false })
        .limit(10);
      orders = orderData || [];
    } catch {
      // Orders table might not exist
    }

    res.json({
      success: true,
      data: {
        ...customer,
        recent_orders: orders,
      },
    });
  } catch (error: any) {
    console.error("Get customer error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch customer",
    });
  }
});

/**
 * PATCH /api/admin/users/:id/status
 * Update user status (works for both customers and sellers)
 */
router.patch("/users/:id/status", async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["active", "suspended", "banned"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status. Must be: active, suspended, or banned",
      });
    }

    // Update user status
    const { data, error } = await supabase
      .from("users")
      .update({
        account_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", id)
      .select()
      .single();

    if (error) {
      console.error("Status update error:", error);
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Log the action
    console.log(`Admin updated user ${id} status to ${status}`);

    res.json({
      success: true,
      message: `User ${status === "active" ? "activated" : status} successfully`,
      data,
    });
  } catch (error: any) {
    console.error("Update status error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update status",
    });
  }
});

/**
 * GET /api/admin/customers/stats
 * Get customer statistics
 */
router.get("/customers/stats", async (req: AuthRequest, res: Response) => {
  try {
    // Total customers
    const { count: totalCustomers } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("role", "buyer");

    // Active customers
    const { count: activeCustomers } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("role", "buyer")
      .eq("account_status", "active");

    // Suspended customers
    const { count: suspendedCustomers } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("role", "buyer")
      .eq("account_status", "suspended");

    // Banned customers
    const { count: bannedCustomers } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("role", "buyer")
      .eq("account_status", "banned");

    // New customers this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { count: newThisMonth } = await supabase
      .from("users")
      .select("*", { count: "exact", head: true })
      .eq("role", "buyer")
      .gte("created_at", startOfMonth.toISOString());

    res.json({
      success: true,
      data: {
        total: totalCustomers || 0,
        active: activeCustomers || 0,
        suspended: suspendedCustomers || 0,
        banned: bannedCustomers || 0,
        newThisMonth: newThisMonth || 0,
      },
    });
  } catch (error: any) {
    console.error("Get stats error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch stats",
    });
  }
});

export default router;