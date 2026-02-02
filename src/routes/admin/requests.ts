// src/routes/admin/requests.ts
// Admin API routes for product requests management

import express from 'express';
import { supabaseAdmin as supabase } from '../../config/supabase';
import { authenticateToken, AuthRequest, requireAdmin } from '../../middleware/auth';

const router = express.Router();

// ============================================================
// GET ALL PRODUCT REQUESTS (Admin view)
// ============================================================

/**
 * GET /api/admin/requests
 * Get all product requests with filters for admin
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
      .from('product_requests')
      .select('*', { count: 'exact' });

    // Apply filters
    if (status && status !== 'all') {
      if (status === 'responded') {
        query = query.eq('status', 'responded');
      } else if (status === 'not_responded') {
        query = query.eq('status', 'not_responded');
      } else {
        query = query.eq('status', status);
      }
    }

    if (search) {
      query = query.or(`product_name.ilike.%${search}%,description.ilike.%${search}%,category.ilike.%${search}%`);
    }

    // Apply sorting
    query = query.order(sortBy as string, { ascending: sortOrder === 'asc' });

    // Apply pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: requests, error, count } = await query;

    if (error) {
      console.error('Query error:', error);
      throw error;
    }

    // Get user profiles for requesters
    const userIds = [...new Set(requests?.map(r => r.user_id) || [])];
    let profiles: any[] = [];
    
    if (userIds.length > 0) {
      const { data: profileData } = await supabase
        .from('users')
        .select('user_id, name, email, profile_picture, location_state, location_city')
        .in('user_id', userIds);
      profiles = profileData || [];
    }

    const profileMap = new Map(profiles.map(p => [p.user_id, p]));

    // Transform data for frontend
    const transformedRequests = (requests || []).map(request => {
      const requester = profileMap.get(request.user_id);
      
      return {
        id: request.request_id,
        productName: request.product_name,
        category: request.category,
        subcategory: request.subcategory,
        description: request.description,
        condition: request.condition === 'fairly_used' ? 'Fairly Used' : 'Brand New',
        quantity: request.quantity,
        priceMin: request.price_min,
        priceMax: request.price_max,
        priceRange: request.price_min && request.price_max 
          ? `₦${Number(request.price_min).toLocaleString()} - ₦${Number(request.price_max).toLocaleString()}`
          : request.price_max 
            ? `Up to ₦${Number(request.price_max).toLocaleString()}`
            : 'Not specified',
        deliveryLocation: request.delivery_location,
        deliveryState: request.delivery_state,
        deliveryCity: request.delivery_city,
        status: request.status === 'not_responded' ? 'Not Responded' : 'Responded',
        statusRaw: request.status,
        responseCount: request.response_count || 0,
        isActive: request.is_active,
        requester: requester ? {
          id: request.user_id,
          name: requester.name,
          email: requester.email,
          profilePic: requester.profile_picture,
          location: [requester.location_city, requester.location_state].filter(Boolean).join(', ')
        } : null,
        date: formatDate(request.created_at),
        dateRaw: request.created_at,
        expiresAt: request.expires_at
      };
    });

    res.json({
      success: true,
      data: transformedRequests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum)
      }
    });

  } catch (error: any) {
    console.error('❌ Admin requests fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch requests'
    });
  }
});

/**
 * GET /api/admin/requests/stats
 * Get request statistics
 */
router.get('/stats', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { data: allRequests, error } = await supabase
      .from('product_requests')
      .select('status, is_active, response_count');

    if (error) throw error;

    const stats = {
      total: allRequests?.length || 0,
      notResponded: allRequests?.filter(r => r.status === 'not_responded').length || 0,
      responded: allRequests?.filter(r => r.status === 'responded').length || 0,
      active: allRequests?.filter(r => r.is_active).length || 0,
      totalResponses: allRequests?.reduce((sum, r) => sum + (r.response_count || 0), 0) || 0
    };

    res.json({
      success: true,
      data: stats
    });

  } catch (error: any) {
    console.error('❌ Request stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch request statistics'
    });
  }
});

/**
 * GET /api/admin/requests/:requestId
 * Get single request with all responses
 */
router.get('/:requestId', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { requestId } = req.params;

    // Get the request
    const { data: request, error } = await supabase
      .from('product_requests')
      .select('*')
      .eq('request_id', requestId)
      .single();

    if (error || !request) {
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }

    // Get requester info
    const { data: requester } = await supabase
      .from('users')
      .select('user_id, name, email, profile_picture, phone_number, location_state, location_city')
      .eq('user_id', request.user_id)
      .single();

    // Get all responses
    const { data: responses } = await supabase
      .from('request_responses')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false });

    // Get seller info for responses
    let formattedResponses: any[] = [];
    if (responses && responses.length > 0) {
      const sellerIds = [...new Set(responses.map(r => r.seller_id))];
      const { data: sellers } = await supabase
        .from('users')
        .select('user_id, name, email, profile_picture, phone_number')
        .in('user_id', sellerIds);

      const sellerMap = new Map((sellers || []).map(s => [s.user_id, s]));

      // Get store names
      const { data: kycData } = await supabase
        .from('kyc_applications')
        .select('user_id, store_name')
        .in('user_id', sellerIds);

      const storeMap = new Map((kycData || []).map(k => [k.user_id, k.store_name]));

      formattedResponses = responses.map(resp => {
        const seller = sellerMap.get(resp.seller_id);
        return {
          id: resp.response_id,
          sellerId: resp.seller_id,
          sellerName: seller?.name || 'Unknown',
          sellerEmail: seller?.email,
          sellerPhone: seller?.phone_number,
          sellerProfilePic: seller?.profile_picture,
          storeName: storeMap.get(resp.seller_id),
          message: resp.message,
          offeredPrice: resp.offered_price,
          estimatedDelivery: resp.estimated_delivery,
          productId: resp.product_id,
          status: resp.status,
          isRead: resp.is_read,
          createdAt: resp.created_at,
          date: formatDate(resp.created_at)
        };
      });
    }

    res.json({
      success: true,
      data: {
        id: request.request_id,
        productName: request.product_name,
        category: request.category,
        subcategory: request.subcategory,
        description: request.description,
        condition: request.condition === 'fairly_used' ? 'Fairly Used' : 'Brand New',
        quantity: request.quantity,
        priceMin: request.price_min,
        priceMax: request.price_max,
        deliveryLocation: request.delivery_location,
        deliveryState: request.delivery_state,
        deliveryCity: request.delivery_city,
        status: request.status,
        responseCount: request.response_count,
        isActive: request.is_active,
        requester: requester ? {
          id: requester.user_id,
          name: requester.name,
          email: requester.email,
          phone: requester.phone_number,
          profilePic: requester.profile_picture,
          location: [requester.location_city, requester.location_state].filter(Boolean).join(', ')
        } : null,
        responses: formattedResponses,
        createdAt: request.created_at,
        expiresAt: request.expires_at
      }
    });

  } catch (error: any) {
    console.error('❌ Request fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch request'
    });
  }
});

/**
 * DELETE /api/admin/requests/:requestId
 * Delete a product request (admin only)
 */
router.delete('/:requestId', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { requestId } = req.params;
    const adminId = req.user!.id;

    // Delete responses first
    await supabase
      .from('request_responses')
      .delete()
      .eq('request_id', requestId);

    // Delete the request
    const { error } = await supabase
      .from('product_requests')
      .delete()
      .eq('request_id', requestId);

    if (error) throw error;

    // Log admin action
    try {
      await supabase.from('admin_logs').insert({
        admin_id: adminId,
        action: 'delete_request',
        target_type: 'product_request',
        target_id: requestId,
        created_at: new Date().toISOString()
      });
    } catch (e) {}

    res.json({
      success: true,
      message: 'Request deleted successfully'
    });

  } catch (error: any) {
    console.error('❌ Request delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete request'
    });
  }
});

/**
 * PATCH /api/admin/requests/:requestId/toggle-active
 * Toggle request active status
 */
router.patch('/:requestId/toggle-active', authenticateToken, requireAdmin, async (req: AuthRequest, res) => {
  try {
    const { requestId } = req.params;

    // Get current status
    const { data: request, error: fetchError } = await supabase
      .from('product_requests')
      .select('is_active')
      .eq('request_id', requestId)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }

    // Toggle status
    const { error } = await supabase
      .from('product_requests')
      .update({ 
        is_active: !request.is_active,
        updated_at: new Date().toISOString()
      })
      .eq('request_id', requestId);

    if (error) throw error;

    res.json({
      success: true,
      message: `Request ${request.is_active ? 'deactivated' : 'activated'} successfully`,
      isActive: !request.is_active
    });

  } catch (error: any) {
    console.error('❌ Toggle active error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle request status'
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