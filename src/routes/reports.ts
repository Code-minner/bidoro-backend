// src/routes/admin/reports.ts
// Admin API routes for product reports management

import express from 'express';
import { supabaseAdmin as supabase } from '../config/database';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';

const router = express.Router();

// ============================================================
// PRODUCT REPORTS ROUTES
// ============================================================

/**
 * GET /api/admin/reports
 * Get all product reports with filters
 */
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const {
      status,
      search,
      page = '1',
      limit = '20',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from('product_reports')
      .select(`
        *,
        products(
          product_id,
          name,
          slug,
          price,
          status,
          product_images(image_url, is_primary)
        ),
        reporter:users!product_reports_reporter_id_fkey(
          user_id,
          name,
          email,
          profile_picture
        )
      `, { count: 'exact' });

    // Apply filters
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.or(`reason.ilike.%${search}%,details.ilike.%${search}%`);
    }

    // Apply sorting
    query = query.order(sortBy as string, { ascending: sortOrder === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: reports, error, count } = await query;

    if (error) {
      console.error('Query error:', error);
      throw error;
    }

    // Get seller info for each product
    const transformedReports = await Promise.all(
      (reports || []).map(async (report) => {
        let seller = null;
        
        if (report.products) {
          const { data: sellerData } = await supabase
            .from('products')
            .select('seller_id')
            .eq('product_id', report.product_id)
            .single();

          if (sellerData?.seller_id) {
            const { data: sellerInfo } = await supabase
              .from('users')
              .select('user_id, name, email, profile_picture')
              .eq('user_id', sellerData.seller_id)
              .single();
            
            seller = sellerInfo;
          }
        }

        const primaryImage = report.products?.product_images?.find((img: any) => img.is_primary);
        
        return {
          id: report.report_id,
          productId: report.product_id,
          productName: report.products?.name || 'Unknown Product',
          productImage: primaryImage?.image_url || report.products?.product_images?.[0]?.image_url || null,
          productSlug: report.products?.slug,
          productStatus: report.products?.status,
          seller: seller?.name || 'Unknown Seller',
          sellerEmail: seller?.email,
          sellerProfilePic: seller?.profile_picture,
          reporter: report.reporter?.name || 'Anonymous',
          reporterEmail: report.reporter?.email,
          reporterProfilePic: report.reporter?.profile_picture,
          reason: report.reason,
          details: report.details,
          status: report.status === 'pending' ? 'Unresolved' : 'Resolved',
          statusRaw: report.status,
          resolutionAction: report.resolution_action,
          resolutionNotes: report.resolution_notes,
          date: formatDate(report.created_at),
          dateRaw: report.created_at
        };
      })
    );

    res.json({
      success: true,
      data: transformedReports,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum)
      }
    });

  } catch (error: any) {
    console.error('❌ Admin reports fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reports'
    });
  }
});

/**
 * GET /api/admin/reports/stats
 * Get report statistics
 */
router.get('/stats', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data: allReports, error } = await supabase
      .from('product_reports')
      .select('status');

    if (error) throw error;

    const stats = {
      total: allReports?.length || 0,
      pending: allReports?.filter(r => r.status === 'pending').length || 0,
      resolved: allReports?.filter(r => r.status === 'resolved').length || 0,
      dismissed: allReports?.filter(r => r.status === 'dismissed').length || 0
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error: any) {
    console.error('❌ Report stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch report statistics'
    });
  }
});

/**
 * GET /api/admin/reports/:reportId
 * Get single report details
 */
router.get('/:reportId', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { reportId } = req.params;

    const { data: report, error } = await supabase
      .from('product_reports')
      .select(`
        *,
        products(
          *,
          product_images(image_url, is_primary, display_order),
          categories(name, slug)
        ),
        reporter:users!product_reports_reporter_id_fkey(
          user_id,
          name,
          email,
          profile_picture
        )
      `)
      .eq('report_id', reportId)
      .single();

    if (error || !report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      });
    }

    // Get seller info
    let seller = null;
    if (report.products?.seller_id) {
      const { data: sellerData } = await supabase
        .from('users')
        .select('user_id, name, email, profile_picture, phone_number')
        .eq('user_id', report.products.seller_id)
        .single();

      // Get store info
      const { data: kycData } = await supabase
        .from('kyc_applications')
        .select('store_name')
        .eq('user_id', report.products.seller_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      seller = {
        ...sellerData,
        store_name: kycData?.store_name
      };
    }

    res.json({
      success: true,
      data: {
        ...report,
        seller
      }
    });

  } catch (error: any) {
    console.error('❌ Report fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch report'
    });
  }
});

/**
 * POST /api/admin/reports/:reportId/resolve
 * Resolve a report with action
 */
router.post('/:reportId/resolve', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { reportId } = req.params;
    const { action, notes } = req.body;
    const adminId = req.user!.id;

    // Valid actions: dismiss, warn_seller, suspend_product, delete_product
    const validActions = ['dismiss', 'warn_seller', 'suspend_product', 'delete_product'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }

    // Get report with product
    const { data: report, error: fetchError } = await supabase
      .from('product_reports')
      .select('*, products(product_id, name, seller_id)')
      .eq('report_id', reportId)
      .single();

    if (fetchError || !report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found'
      });
    }

    // Update report status
    const { error: updateError } = await supabase
      .from('product_reports')
      .update({
        status: 'resolved',
        resolution_action: action,
        resolution_notes: notes,
        resolved_by: adminId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('report_id', reportId);

    if (updateError) throw updateError;

    // Take action on product if needed
    if (action === 'suspend_product' && report.product_id) {
      await supabase
        .from('products')
        .update({ status: 'suspended', updated_at: new Date().toISOString() })
        .eq('product_id', report.product_id);
    } else if (action === 'delete_product' && report.product_id) {
      // Soft delete or hard delete based on your preference
      await supabase
        .from('products')
        .update({ status: 'deleted', updated_at: new Date().toISOString() })
        .eq('product_id', report.product_id);
    }

    // Log admin action
    try {
      await supabase.from('admin_logs').insert({
        admin_id: adminId,
        action: `resolve_report_${action}`,
        target_type: 'report',
        target_id: reportId,
        details: { 
          productId: report.product_id,
          productName: report.products?.name,
          action,
          notes 
        },
        created_at: new Date().toISOString()
      });
    } catch (e) {
      // Admin logs table might not exist
    }

    res.json({
      success: true,
      message: `Report resolved with action: ${action}`
    });

  } catch (error: any) {
    console.error('❌ Report resolution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resolve report'
    });
  }
});

/**
 * DELETE /api/admin/reports/:reportId
 * Delete a report (admin only)
 */
router.delete('/:reportId', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { reportId } = req.params;
    const adminId = req.user!.id;

    const { error } = await supabase
      .from('product_reports')
      .delete()
      .eq('report_id', reportId);

    if (error) throw error;

    // Log admin action
    try {
      await supabase.from('admin_logs').insert({
        admin_id: adminId,
        action: 'delete_report',
        target_type: 'report',
        target_id: reportId,
        created_at: new Date().toISOString()
      });
    } catch (e) {}

    res.json({
      success: true,
      message: 'Report deleted successfully'
    });

  } catch (error: any) {
    console.error('❌ Report delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete report'
    });
  }
});

// ============================================================
// USER-FACING REPORT ENDPOINTS (for frontend to submit reports)
// ============================================================

/**
 * POST /api/admin/reports/submit
 * Submit a new product report (authenticated users)
 */
router.post('/submit', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { productId, reason, details } = req.body;

    if (!productId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Product ID and reason are required'
      });
    }

    // Check if product exists
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('product_id, name')
      .eq('product_id', productId)
      .single();

    if (productError || !product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check if user already reported this product
    const { data: existingReport } = await supabase
      .from('product_reports')
      .select('report_id')
      .eq('product_id', productId)
      .eq('reporter_id', userId)
      .eq('status', 'pending')
      .single();

    if (existingReport) {
      return res.status(400).json({
        success: false,
        error: 'You have already reported this product'
      });
    }

    // Create report
    const { data: report, error: insertError } = await supabase
      .from('product_reports')
      .insert({
        product_id: productId,
        reporter_id: userId,
        reason,
        details,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) throw insertError;

    res.status(201).json({
      success: true,
      message: 'Report submitted successfully. Our team will review it.',
      data: { reportId: report.report_id }
    });

  } catch (error: any) {
    console.error('❌ Report submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit report'
    });
  }
});

// Helper function
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  });
}

export default router;