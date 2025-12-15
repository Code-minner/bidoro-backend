// src/routes/admin-sellers.ts
import express from 'express';
import { Response } from 'express';
import { supabaseAdmin as supabase } from "../config/database";
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';

const router = express.Router();

// TODO: Uncomment these when admin login is implemented
// router.use(authenticateToken);
// router.use(requireAdmin);

/**
 * GET /api/admin/sellers
 * Get all approved sellers with pagination, search, and filters
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      location,
      sort = 'created_at',
      order = 'desc'
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    // Build query for sellers (users with role = 'seller' and kyc_status = 'verified')
    let query = supabase
      .from('users')
      .select(`
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
      `, { count: 'exact' })
      .eq('role', 'seller')
      .eq('kyc_status', 'verified')
      .order(sort as string, { ascending: order === 'asc' })
      .range(offset, offset + Number(limit) - 1);

    // Apply filters
    if (status && status !== 'all') {
      query = query.eq('account_status', status);
    }

    if (location) {
      query = query.ilike('location_state', `%${location}%`);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,phone_number.ilike.%${search}%`);
    }

    const { data: sellers, error, count } = await query;

    if (error) {
      console.error('Admin sellers fetch error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch sellers',
        error: error.message
      });
    }

    // Get product counts for each seller
    const sellerIds = sellers?.map(s => s.user_id) || [];
    
    let productCounts: Record<string, number> = {};
    
    if (sellerIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('seller_id')
        .in('seller_id', sellerIds);

      if (products) {
        productCounts = products.reduce((acc: Record<string, number>, p: any) => {
          acc[p.seller_id] = (acc[p.seller_id] || 0) + 1;
          return acc;
        }, {});
      }
    }

    // Format response
    const formattedSellers = sellers?.map(seller => ({
      id: seller.user_id,
      name: seller.name,
      email: seller.email,
      phoneNumber: seller.phone_number,
      status: seller.account_status === 'active' ? 'Active' : 'Suspended',
      location: seller.location_state || '-',
      regDate: new Date(seller.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
      }),
      products: productCounts[seller.user_id] || 0
    })) || [];

    // Get summary stats
    const { data: allSellers } = await supabase
      .from('users')
      .select('account_status')
      .eq('role', 'seller')
      .eq('kyc_status', 'verified');

    const summary = {
      total: allSellers?.length || 0,
      active: allSellers?.filter(s => s.account_status === 'active').length || 0,
      suspended: allSellers?.filter(s => s.account_status === 'suspended').length || 0
    };

    res.json({
      success: true,
      data: {
        sellers: formattedSellers,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / Number(limit))
        },
        summary
      }
    });

  } catch (error) {
    console.error('Admin sellers error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/admin/sellers/:id
 * Get single seller details
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get seller
    const { data: seller, error } = await supabase
      .from('users')
      .select(`
        user_id,
        name,
        email,
        phone_number,
        role,
        account_status,
        kyc_status,
        location_state,
        location_city,
        location_area,
        created_at,
        updated_at
      `)
      .eq('user_id', id)
      .eq('role', 'seller')
      .single();

    if (error || !seller) {
      return res.status(404).json({
        success: false,
        message: 'Seller not found'
      });
    }

    // Get seller profile
    const { data: profile } = await supabase
      .from('seller_profiles')
      .select('*')
      .eq('user_id', id)
      .single();

    // Get product count
    const { count: productCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('seller_id', id);

    // Get KYC application details
    const { data: kycApplication } = await supabase
      .from('kyc_applications')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Get KYC documents
    let documents: any[] = [];
    if (kycApplication) {
      const { data: docs } = await supabase
        .from('kyc_documents')
        .select('*')
        .eq('application_id', kycApplication.application_id);
      documents = docs || [];
    }

    res.json({
      success: true,
      data: {
        seller: {
          id: seller.user_id,
          firstName: seller.name?.split(' ')[0] || '',
          lastName: seller.name?.split(' ').slice(1).join(' ') || '',
          email: seller.email,
          phoneNumber: seller.phone_number,
          countryCode: '+234',
          status: seller.account_status === 'active' ? 'Active' : 'Suspended',
          location: {
            state: seller.location_state,
            city: seller.location_city,
            area: seller.location_area
          },
          address: kycApplication?.address || '',
          identityNumber: kycApplication?.id_number || '',
          businessName: profile?.business_name || '',
          businessAddress: profile?.store_address || '',
          businessIdentityNumber: profile?.business_registration_number || '',
          regDate: seller.created_at,
          products: productCount || 0
        },
        documents: documents.map(doc => ({
          id: doc.document_id,
          name: doc.document_type === 'id_card' ? 'ID card (National ID card)' :
                doc.document_type === 'selfie' ? 'Personal photo/Selfie' :
                doc.document_type === 'business_cert' ? 'Business document (CAC)' :
                doc.document_type,
          type: doc.file_type?.includes('pdf') ? 'pdf' : 'image',
          url: doc.file_url,
          size: doc.file_size,
          uploadedAt: doc.created_at,
          status: doc.verification_status
        })),
        kycApplication
      }
    });

  } catch (error) {
    console.error('Admin seller details error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * PUT /api/admin/sellers/:id/suspend
 * Suspend a seller
 */
router.put('/:id/suspend', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Get current seller
    const { data: seller, error: fetchError } = await supabase
      .from('users')
      .select('user_id, name, email, account_status')
      .eq('user_id', id)
      .eq('role', 'seller')
      .single();

    if (fetchError || !seller) {
      return res.status(404).json({
        success: false,
        message: 'Seller not found'
      });
    }

    if (seller.account_status === 'suspended') {
      return res.status(400).json({
        success: false,
        message: 'Seller is already suspended'
      });
    }

    // Update seller status
    const { error: updateError } = await supabase
      .from('users')
      .update({
        account_status: 'suspended',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', id);

    if (updateError) {
      console.error('Suspend error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to suspend seller'
      });
    }

    res.json({
      success: true,
      message: 'Seller suspended successfully',
      data: {
        sellerId: id,
        sellerName: seller.name,
        newStatus: 'suspended'
      }
    });

  } catch (error) {
    console.error('Admin suspend error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * PUT /api/admin/sellers/:id/unsuspend
 * Reactivate a suspended seller
 */
router.put('/:id/unsuspend', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get current seller
    const { data: seller, error: fetchError } = await supabase
      .from('users')
      .select('user_id, name, email, account_status')
      .eq('user_id', id)
      .eq('role', 'seller')
      .single();

    if (fetchError || !seller) {
      return res.status(404).json({
        success: false,
        message: 'Seller not found'
      });
    }

    if (seller.account_status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Seller is already active'
      });
    }

    // Update seller status
    const { error: updateError } = await supabase
      .from('users')
      .update({
        account_status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', id);

    if (updateError) {
      console.error('Unsuspend error:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to reactivate seller'
      });
    }

    res.json({
      success: true,
      message: 'Seller reactivated successfully',
      data: {
        sellerId: id,
        sellerName: seller.name,
        newStatus: 'active'
      }
    });

  } catch (error) {
    console.error('Admin unsuspend error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;