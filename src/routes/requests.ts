// ================================================
// BIDORO BACKEND - PRODUCT REQUESTS API ROUTES
// File: src/routes/requests.ts
// ================================================

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth';
import { Response } from 'express';

const router = Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ================================================
// GET ALL PRODUCT REQUESTS (Public - for sellers to browse)
// ================================================
router.get('/browse', optionalAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      category,
      subcategory,
      condition,
      minPrice,
      maxPrice,
      state,
      city,
      search,
      page = '1',
      limit = '10',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('product_requests')
      .select(`
        request_id,
        user_id,
        product_name,
        category,
        subcategory,
        description,
        condition,
        quantity,
        price_min,
        price_max,
        currency,
        delivery_location,
        delivery_state,
        delivery_city,
        status,
        response_count,
        is_active,
        expires_at,
        created_at,
        updated_at
      `, { count: 'exact' })
      .eq('is_active', true);

    // Filters
    if (category) query = query.eq('category', category);
    if (subcategory) query = query.eq('subcategory', subcategory);
    if (condition) query = query.eq('condition', condition);
    if (state) query = query.eq('delivery_state', state);
    if (city) query = query.eq('delivery_city', city);
    if (minPrice) query = query.gte('price_max', minPrice);
    if (maxPrice) query = query.lte('price_min', maxPrice);
    if (search) {
      query = query.or(`product_name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortBy as string, { ascending });

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: requests, error, count } = await query;

    if (error) throw error;

    // Get user profiles
    const userIds = [...new Set(requests?.map(r => r.user_id) || [])];
    let profiles: any[] = [];
    if (userIds.length > 0) {
      const { data } = await supabase
        .from('users')
        .select('user_id, name, profile_picture, location_state, location_city')
        .in('user_id', userIds);
      profiles = data || [];
    }

    const profileMap = new Map(profiles.map(p => [p.user_id, p]));

    // Format response
    const formattedRequests = requests?.map(request => {
      const profile = profileMap.get(request.user_id);
      return {
        id: request.request_id,
        productName: request.product_name,
        category: request.category,
        subcategory: request.subcategory,
        description: request.description,
        condition: request.condition,
        quantity: request.quantity,
        priceRange: {
          min: Number(request.price_min) || 0,
          max: Number(request.price_max) || 0,
          currency: request.currency || 'NGN'
        },
        deliveryLocation: request.delivery_location,
        deliveryState: request.delivery_state,
        deliveryCity: request.delivery_city,
        status: request.status,
        responseCount: request.response_count,
        requester: profile ? {
          id: request.user_id,
          name: profile.name,
          avatar: profile.profile_picture,
          location: `${profile.location_city || ''}, ${profile.location_state || ''}`.replace(/^, |, $/g, '')
        } : null,
        createdAt: request.created_at,
        expiresAt: request.expires_at
      };
    }) || [];

    const totalPages = Math.ceil((count || 0) / limitNum);

    res.json({
      success: true,
      data: formattedRequests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (error: any) {
    console.error('Error fetching product requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product requests',
      error: error.message
    });
  }
});

// ================================================
// GET MY REQUESTS (Buyer's own requests)
// ================================================
router.get('/my-requests', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      status,
      page = '1',
      limit = '10',
      sortBy = 'created_at',
      sortOrder = 'desc',
      search
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('product_requests')
      .select('*', { count: 'exact' })
      .eq('user_id', userId);

    // Filter by status
    if (status && status !== 'all') {
      if (status === 'responded') {
        query = query.eq('status', 'responded');
      } else if (status === 'not_responded' || status === 'not responded') {
        query = query.eq('status', 'not_responded');
      } else {
        query = query.eq('status', status);
      }
    }

    // Search
    if (search) {
      query = query.or(`product_name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Sorting
    const ascending = sortOrder === 'asc';
    query = query.order(sortBy as string, { ascending });

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: requests, error, count } = await query;

    if (error) throw error;

    // Format response
    const formattedRequests = requests?.map(request => ({
      id: request.request_id,
      productId: request.request_id, // Alias for frontend compatibility
      productName: request.product_name,
      productCategory: request.category,
      productSubcategory: request.subcategory,
      productDescription: request.description,
      productCondition: request.condition,
      productQuantity: request.quantity,
      priceRange: {
        from: `₦${(Number(request.price_min) || 0).toLocaleString()}`,
        to: `₦${(Number(request.price_max) || 0).toLocaleString()}`
      },
      deliveryLocation: request.delivery_location,
      status: request.status === 'not_responded' ? 'not responded' : request.status,
      responseCount: request.response_count,
      requestedDate: request.created_at,
      createdAt: request.created_at,
      updatedAt: request.updated_at
    })) || [];

    const totalPages = Math.ceil((count || 0) / limitNum);

    res.json({
      success: true,
      data: formattedRequests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (error: any) {
    console.error('Error fetching my requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your requests',
      error: error.message
    });
  }
});

// ================================================
// GET SINGLE REQUEST WITH RESPONSES
// ================================================
router.get('/:requestId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = req.user!.id;

    // Get the request
    const { data: request, error } = await supabase
      .from('product_requests')
      .select('*')
      .eq('request_id', requestId)
      .single();

    if (error || !request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Get responses if user is the request owner
    let responses: any[] = [];
    if (request.user_id === userId) {
      const { data: responseData } = await supabase
        .from('request_responses')
        .select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: false });

      if (responseData && responseData.length > 0) {
        // Get seller profiles
        const sellerIds = responseData.map(r => r.seller_id);
        const { data: sellers } = await supabase
          .from('users')
          .select('user_id, name, profile_picture, email, phone')
          .in('user_id', sellerIds);

        const sellerMap = new Map((sellers || []).map(s => [s.user_id, s]));

        responses = responseData.map(resp => {
          const seller = sellerMap.get(resp.seller_id);
          return {
            id: resp.response_id,
            sellerId: resp.seller_id,
            sellerName: seller?.name || 'Unknown Seller',
            sellerImage: seller?.profile_picture || '/default-avatar.png',
            sellerEmail: seller?.email,
            sellerPhone: seller?.phone,
            message: resp.message,
            offeredPrice: resp.offered_price,
            estimatedDelivery: resp.estimated_delivery,
            productId: resp.product_id,
            status: resp.status,
            isRead: resp.is_read,
            timeStamp: resp.created_at,
            createdAt: resp.created_at
          };
        });
      }
    }

    // Get requester profile
    const { data: requester } = await supabase
      .from('users')
      .select('user_id, name, profile_picture, location_state, location_city')
      .eq('user_id', request.user_id)
      .single();

    res.json({
      success: true,
      data: {
        id: request.request_id,
        productName: request.product_name,
        category: request.category,
        subcategory: request.subcategory,
        description: request.description,
        condition: request.condition,
        quantity: request.quantity,
        priceRange: {
          min: Number(request.price_min) || 0,
          max: Number(request.price_max) || 0,
          from: `₦${(Number(request.price_min) || 0).toLocaleString()}`,
          to: `₦${(Number(request.price_max) || 0).toLocaleString()}`,
          currency: request.currency || 'NGN'
        },
        deliveryLocation: request.delivery_location,
        deliveryState: request.delivery_state,
        deliveryCity: request.delivery_city,
        status: request.status === 'not_responded' ? 'not responded' : request.status,
        responseCount: request.response_count,
        isOwner: request.user_id === userId,
        requester: requester ? {
          id: requester.user_id,
          name: requester.name,
          avatar: requester.profile_picture,
          location: `${requester.location_city || ''}, ${requester.location_state || ''}`.replace(/^, |, $/g, '')
        } : null,
        responses,
        createdAt: request.created_at,
        updatedAt: request.updated_at
      }
    });
  } catch (error: any) {
    console.error('Error fetching request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch request',
      error: error.message
    });
  }
});

// ================================================
// CREATE NEW PRODUCT REQUEST
// ================================================
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      productName,
      category,
      subcategory,
      description,
      condition = 'brand_new',
      quantity = 1,
      priceMin,
      priceMax,
      deliveryLocation,
      deliveryState,
      deliveryCity,
      expiresInDays = 30
    } = req.body;

    // Validate required fields
    if (!productName || !category) {
      return res.status(400).json({
        success: false,
        message: 'Product name and category are required'
      });
    }

    // Calculate expiry date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const requestId = uuidv4();

    const { data: request, error } = await supabase
      .from('product_requests')
      .insert({
        request_id: requestId,
        user_id: userId,
        product_name: productName,
        category,
        subcategory: subcategory || null,
        description: description || null,
        condition: condition === 'Fairly used' ? 'fairly_used' : 'brand_new',
        quantity: Math.max(1, quantity),
        price_min: priceMin || null,
        price_max: priceMax || null,
        currency: 'NGN',
        delivery_location: deliveryLocation || null,
        delivery_state: deliveryState || null,
        delivery_city: deliveryCity || null,
        status: 'not_responded',
        response_count: 0,
        is_active: true,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Product request created successfully',
      data: {
        id: request.request_id,
        productName: request.product_name,
        category: request.category,
        status: 'not responded',
        createdAt: request.created_at
      }
    });
  } catch (error: any) {
    console.error('Error creating request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product request',
      error: error.message
    });
  }
});

// ================================================
// UPDATE PRODUCT REQUEST
// ================================================
router.patch('/:requestId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = req.user!.id;

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('product_requests')
      .select('user_id, status')
      .eq('request_id', requestId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    if (existing.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own requests'
      });
    }

    // Only allow editing if no responses yet
    if (existing.status === 'responded') {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit a request that has responses'
      });
    }

    const {
      productName,
      category,
      subcategory,
      description,
      condition,
      quantity,
      priceMin,
      priceMax,
      deliveryLocation,
      deliveryState,
      deliveryCity
    } = req.body;

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (productName) updateData.product_name = productName;
    if (category) updateData.category = category;
    if (subcategory !== undefined) updateData.subcategory = subcategory;
    if (description !== undefined) updateData.description = description;
    if (condition) updateData.condition = condition === 'Fairly used' ? 'fairly_used' : 'brand_new';
    if (quantity) updateData.quantity = Math.max(1, quantity);
    if (priceMin !== undefined) updateData.price_min = priceMin;
    if (priceMax !== undefined) updateData.price_max = priceMax;
    if (deliveryLocation !== undefined) updateData.delivery_location = deliveryLocation;
    if (deliveryState !== undefined) updateData.delivery_state = deliveryState;
    if (deliveryCity !== undefined) updateData.delivery_city = deliveryCity;

    const { data: request, error } = await supabase
      .from('product_requests')
      .update(updateData)
      .eq('request_id', requestId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Request updated successfully',
      data: {
        id: request.request_id,
        productName: request.product_name,
        updatedAt: request.updated_at
      }
    });
  } catch (error: any) {
    console.error('Error updating request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update request',
      error: error.message
    });
  }
});

// ================================================
// DELETE PRODUCT REQUEST
// ================================================
router.delete('/:requestId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const userId = req.user!.id;

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('product_requests')
      .select('user_id')
      .eq('request_id', requestId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    if (existing.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own requests'
      });
    }

    const { error } = await supabase
      .from('product_requests')
      .delete()
      .eq('request_id', requestId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Request deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete request',
      error: error.message
    });
  }
});

// ================================================
// SELLER: RESPOND TO A REQUEST
// ================================================
router.post('/:requestId/respond', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const sellerId = req.user!.id;

    // Verify seller role
    if (req.user!.role !== 'seller') {
      return res.status(403).json({
        success: false,
        message: 'Only sellers can respond to requests'
      });
    }

    // Check if request exists and is active
    const { data: request, error: requestError } = await supabase
      .from('product_requests')
      .select('request_id, user_id, is_active')
      .eq('request_id', requestId)
      .single();

    if (requestError || !request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    if (!request.is_active) {
      return res.status(400).json({
        success: false,
        message: 'This request is no longer active'
      });
    }

    // Can't respond to own request
    if (request.user_id === sellerId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot respond to your own request'
      });
    }

    // Check for existing response
    const { data: existingResponse } = await supabase
      .from('request_responses')
      .select('response_id')
      .eq('request_id', requestId)
      .eq('seller_id', sellerId)
      .maybeSingle();

    if (existingResponse) {
      return res.status(400).json({
        success: false,
        message: 'You have already responded to this request'
      });
    }

    const { message, offeredPrice, estimatedDelivery, productId } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Response message is required'
      });
    }

    const responseId = uuidv4();

    const { data: response, error } = await supabase
      .from('request_responses')
      .insert({
        response_id: responseId,
        request_id: requestId,
        seller_id: sellerId,
        message,
        offered_price: offeredPrice || null,
        estimated_delivery: estimatedDelivery || null,
        product_id: productId || null,
        status: 'pending',
        is_read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Response sent successfully',
      data: {
        id: response.response_id,
        requestId: response.request_id,
        status: response.status,
        createdAt: response.created_at
      }
    });
  } catch (error: any) {
    console.error('Error responding to request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send response',
      error: error.message
    });
  }
});

// ================================================
// GET MY RESPONSES (Seller's sent responses)
// ================================================
router.get('/seller/my-responses', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const sellerId = req.user!.id;
    const {
      status,
      page = '1',
      limit = '10'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('request_responses')
      .select(`
        *,
        product_requests (
          request_id,
          product_name,
          category,
          quantity,
          price_min,
          price_max,
          user_id
        )
      `, { count: 'exact' })
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    query = query.range(offset, offset + limitNum - 1);

    const { data: responses, error, count } = await query;

    if (error) throw error;

    const formattedResponses = responses?.map(resp => ({
      id: resp.response_id,
      requestId: resp.request_id,
      message: resp.message,
      offeredPrice: resp.offered_price,
      status: resp.status,
      request: resp.product_requests ? {
        id: resp.product_requests.request_id,
        productName: resp.product_requests.product_name,
        category: resp.product_requests.category,
        quantity: resp.product_requests.quantity,
        priceRange: {
          min: resp.product_requests.price_min,
          max: resp.product_requests.price_max
        }
      } : null,
      createdAt: resp.created_at
    })) || [];

    const totalPages = Math.ceil((count || 0) / limitNum);

    res.json({
      success: true,
      data: formattedResponses,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (error: any) {
    console.error('Error fetching my responses:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your responses',
      error: error.message
    });
  }
});

// ================================================
// MARK RESPONSE AS READ
// ================================================
router.patch('/responses/:responseId/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { responseId } = req.params;
    const userId = req.user!.id;

    // Get response with request to verify ownership
    const { data: response, error: fetchError } = await supabase
      .from('request_responses')
      .select(`
        response_id,
        request_id,
        product_requests (user_id)
      `)
      .eq('response_id', responseId)
      .single();

    if (fetchError || !response) {
      return res.status(404).json({
        success: false,
        message: 'Response not found'
      });
    }

    // Only request owner can mark as read
    if ((response as any).product_requests?.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only mark responses to your own requests as read'
      });
    }

    const { error } = await supabase
      .from('request_responses')
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq('response_id', responseId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Response marked as read'
    });
  } catch (error: any) {
    console.error('Error marking response as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark response as read',
      error: error.message
    });
  }
});

export default router;