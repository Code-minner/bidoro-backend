// =============================================================
// FILE: src/routes/auctions.ts
// =============================================================
import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { supabaseAdmin as supabase } from '../config/supabase';

const router = express.Router();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if a string is a valid UUID
 */
const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

/**
 * Check if auctions are currently open (Friday 9AM-12PM)
 */
const isAuctionWindowOpen = async (): Promise<{ isOpen: boolean; message: string; nextWindow?: string }> => {
  const { data: settings } = await supabase
    .from('auction_settings')
    .select('*')
    .eq('is_active', true)
    .single();

  if (!settings) {
    return { isOpen: false, message: 'Auction system is not configured' };
  }

  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 5 = Friday
  const currentTime = now.toTimeString().slice(0, 8); // HH:MM:SS

  const isCorrectDay = currentDay === settings.auction_day;
  const isWithinTime = currentTime >= settings.start_time && currentTime <= settings.end_time;

  if (isCorrectDay && isWithinTime) {
    return { isOpen: true, message: 'Auctions are open!' };
  }

  // Calculate next auction window
  let daysUntilNext = (settings.auction_day - currentDay + 7) % 7;
  if (daysUntilNext === 0 && currentTime > settings.end_time) {
    daysUntilNext = 7; // Next week
  }

  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + daysUntilNext);
  const nextWindow = `${nextDate.toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric' })} at ${settings.start_time.slice(0, 5)}`;

  return {
    isOpen: false,
    message: `Auctions are closed. Next window: ${nextWindow}`,
    nextWindow
  };
};

/**
 * Calculate minimum next bid
 */
const getMinimumBid = async (auctionId: string): Promise<number> => {
  const { data: auction } = await supabase
    .from('auctions')
    .select('current_bid, starting_price')
    .eq('auction_id', auctionId)
    .single();

  const { data: settings } = await supabase
    .from('auction_settings')
    .select('min_bid_increment')
    .single();

  const increment = settings?.min_bid_increment || 100;
  const currentBid = auction?.current_bid || auction?.starting_price || 0;

  return currentBid + increment;
};

// ============================================================
// SELLER ROUTES
// ============================================================

/**
 * POST /api/auctions
 * Create a new auction (from existing product or new)
 */
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sellerId = req.user!.id;
    const {
      productId,        // Optional - if creating from existing product
      title,
      description,
      images,
      categoryId,       // Optional - might be slug or UUID
      startingPrice,
      reservePrice,
      buyNowPrice,
      durationDays,
      locationState,
      locationCity
    } = req.body;

    // Validate required fields
    if (!title || !startingPrice) {
      return res.status(400).json({
        success: false,
        error: 'Title and starting price are required'
      });
    }

    // If productId provided, fetch product details
    let productData: any = null;
    if (productId) {
      const { data: product, error } = await supabase
        .from('products')
        .select(`
          *,
          product_images(image_url, is_primary)
        `)
        .eq('product_id', productId)
        .eq('seller_id', sellerId)
        .single();

      if (error || !product) {
        return res.status(404).json({
          success: false,
          error: 'Product not found or you do not own it'
        });
      }

      productData = product;
    }

    // Handle category_id - only use if it's a valid UUID
    let finalCategoryId = null;
    if (productData?.category_id) {
      finalCategoryId = productData.category_id;
    } else if (categoryId && isValidUUID(categoryId)) {
      finalCategoryId = categoryId;
    }
    // If categoryId is a slug like "accessories", we skip it (null)

    // Calculate scheduled start (next Friday at 12 PM) and end (Friday at 6 PM)
    const { data: settings } = await supabase
      .from('auction_settings')
      .select('*')
      .eq('is_active', true)
      .single();

    let scheduledStart = new Date();
    let scheduledEnd = new Date();
    
    // Default: Friday (5), 12:00 PM start, 6:00 PM end
    const auctionDay = settings?.auction_day ?? 5; // Friday
    const startHour = settings?.start_time ? parseInt(settings.start_time.split(':')[0]) : 12;
    const startMinute = settings?.start_time ? parseInt(settings.start_time.split(':')[1]) : 0;
    const endHour = settings?.end_time ? parseInt(settings.end_time.split(':')[0]) : 18;
    const endMinute = settings?.end_time ? parseInt(settings.end_time.split(':')[1]) : 0;

    // Calculate days until next Friday
    let daysUntilFriday = (auctionDay - scheduledStart.getDay() + 7) % 7;
    if (daysUntilFriday === 0) {
      // If today is Friday, check if auction window has passed
      const currentHour = scheduledStart.getHours();
      if (currentHour >= endHour) {
        daysUntilFriday = 7; // Next Friday
      }
    }
    if (daysUntilFriday === 0 && scheduledStart.getDay() !== auctionDay) {
      daysUntilFriday = 7;
    }

    scheduledStart.setDate(scheduledStart.getDate() + daysUntilFriday);
    scheduledStart.setHours(startHour, startMinute, 0, 0);

    scheduledEnd.setDate(scheduledEnd.getDate() + daysUntilFriday);
    scheduledEnd.setHours(endHour, endMinute, 0, 0);

    // Create auction
    // Ensure images is a proper array
    let imagesArray: string[] = [];
    if (productData?.product_images) {
      imagesArray = productData.product_images.map((img: any) => img.image_url);
    } else if (images) {
      imagesArray = Array.isArray(images) ? images : [images];
    }

    const auctionData = {
      seller_id: sellerId,
      product_id: productId || null,
      title: productData?.name || title,
      description: productData?.description || description || null,
      images: imagesArray,
      category_id: finalCategoryId,
      starting_price: startingPrice,
      reserve_price: reservePrice || null,
      buy_now_price: buyNowPrice || null,
      duration_days: durationDays || 1,
      scheduled_start: scheduledStart.toISOString(),
      scheduled_end: scheduledEnd.toISOString(),
      status: 'scheduled',
      location_state: productData?.location_state || locationState || null,
      location_city: productData?.location_city || locationCity || null
    };

    const { data: auction, error: createError } = await supabase
      .from('auctions')
      .insert(auctionData)
      .select()
      .single();

    if (createError) {
      console.error('Create auction error:', createError);
      throw createError;
    }

    console.log(`✅ Auction created: ${auction.title} by seller ${sellerId}`);

    res.status(201).json({
      success: true,
      data: auction,
      message: `Auction scheduled! It will go live on ${scheduledStart.toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric' })} at ${settings?.start_time?.slice(0, 5) || '09:00'}`
    });

  } catch (error: any) {
    console.error('❌ Create auction error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create auction'
    });
  }
});

/**
 * GET /api/auctions/my-auctions
 * Get seller's auctions
 */
router.get('/my-auctions', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sellerId = req.user!.id;
    const status = req.query.status as string;

    let query = supabase
      .from('auctions')
      .select(`
        *,
        categories(name, slug)
      `)
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (status) {
      if (status === 'active') {
        query = query.in('status', ['active', 'scheduled', 'pending']);
      } else if (status === 'closed') {
        query = query.in('status', ['ended', 'awarded', 'completed', 'no_bids', 'cancelled']);
      } else {
        query = query.eq('status', status);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json({
      success: true,
      data: data || []
    });

  } catch (error: any) {
    console.error('❌ Fetch my auctions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch auctions'
    });
  }
});

/**
 * DELETE /api/auctions/:auctionId
 * Cancel/delete an auction (only if no bids)
 */
router.delete('/:auctionId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { auctionId } = req.params;
    const sellerId = req.user!.id;

    // Check ownership and bid count
    const { data: auction, error: fetchError } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('seller_id', sellerId)
      .single();

    if (fetchError || !auction) {
      return res.status(404).json({
        success: false,
        error: 'Auction not found'
      });
    }

    if (auction.total_bids > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete auction with existing bids. You can only cancel it.'
      });
    }

    // Delete auction
    const { error: deleteError } = await supabase
      .from('auctions')
      .delete()
      .eq('auction_id', auctionId);

    if (deleteError) throw deleteError;

    res.json({
      success: true,
      message: 'Auction deleted successfully'
    });

  } catch (error: any) {
    console.error('❌ Delete auction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete auction'
    });
  }
});

/**
 * PATCH /api/auctions/:auctionId/award
 * Award auction to winning bidder
 */
router.patch('/:auctionId/award', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { auctionId } = req.params;
    const sellerId = req.user!.id;

    // Fetch auction with winning bid
    const { data: auction, error: fetchError } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('seller_id', sellerId)
      .in('status', ['ended'])
      .single();

    if (fetchError || !auction) {
      return res.status(404).json({
        success: false,
        error: 'Auction not found or cannot be awarded'
      });
    }

    // Get winning bid
    const { data: winningBid } = await supabase
      .from('bids')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('status', 'winning')
      .single();

    if (!winningBid) {
      return res.status(400).json({
        success: false,
        error: 'No winning bid found'
      });
    }

    // Update auction
    const { data: updated, error: updateError } = await supabase
      .from('auctions')
      .update({
        status: 'awarded',
        winner_id: winningBid.bidder_id,
        winning_bid: winningBid.bid_amount,
        awarded_at: new Date().toISOString()
      })
      .eq('auction_id', auctionId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Update bid status
    await supabase
      .from('bids')
      .update({ status: 'won' })
      .eq('bid_id', winningBid.bid_id);

    // TODO: Send notification to winner
    // TODO: Create escrow transaction

    res.json({
      success: true,
      data: updated,
      message: 'Auction awarded successfully!'
    });

  } catch (error: any) {
    console.error('❌ Award auction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to award auction'
    });
  }
});

// ============================================================
// BUYER ROUTES
// ============================================================

/**
 * GET /api/auctions
 * Get all active/public auctions
 */
router.get('/', async (req, res) => {
  try {
    const {
      category,
      minPrice,
      maxPrice,
      search,
      status,  // No default - we'll handle undefined below
      page = '1',
      limit = '20'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('auctions')
      .select(`
        *,
        categories(name, slug),
        seller:users!auctions_seller_id_fkey(
          user_id, 
          name, 
          profile_picture, 
          trust_score, 
          kyc_status, 
          created_at, 
          location_state, 
          location_city
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    // Status filter
    if (status === 'active') {
      query = query.eq('status', 'active');
    } else if (status === 'upcoming') {
      query = query.eq('status', 'scheduled');
    } else if (status === 'ended') {
      query = query.in('status', ['ended', 'awarded', 'completed']);
    } else {
      // Default: show both active and scheduled (upcoming) auctions
      query = query.in('status', ['active', 'scheduled']);
    }

    // Category filter
    if (category) {
      query = query.eq('category_id', category);
    }

    // Price filter
    if (minPrice) {
      query = query.gte('starting_price', parseFloat(minPrice as string));
    }
    if (maxPrice) {
      query = query.lte('starting_price', parseFloat(maxPrice as string));
    }

    // Search
    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    // Get auction window status
    const windowStatus = await isAuctionWindowOpen();

    res.json({
      success: true,
      data: data || [],
      auctionWindow: windowStatus,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum)
      }
    });

  } catch (error: any) {
    console.error('❌ Fetch auctions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch auctions'
    });
  }
});

/**
 * GET /api/auctions/window-status
 * Check if auction window is open
 */
router.get('/window-status', async (req, res) => {
  try {
    const status = await isAuctionWindowOpen();
    res.json({
      success: true,
      data: status
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Failed to check auction window'
    });
  }
});

/**
 * GET /api/auctions/:auctionId
 * Get single auction with bid history
 */
router.get('/:auctionId', async (req, res) => {
  try {
    const { auctionId } = req.params;

    // Fetch auction with seller info
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select(`
        *,
        categories(name, slug),
        seller:users!auctions_seller_id_fkey(
          user_id, 
          name, 
          profile_picture, 
          trust_score,
          kyc_status,
          created_at,
          location_state, 
          location_city
        )
      `)
      .eq('auction_id', auctionId)
      .single();

    if (auctionError || !auction) {
      return res.status(404).json({
        success: false,
        error: 'Auction not found'
      });
    }

    // Get store info for seller
    if (auction.seller_id) {
      // Get store name from kyc_applications
      const { data: kycApp } = await supabase
        .from('kyc_applications')
        .select('store_name')
        .eq('user_id', auction.seller_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Get store logo from kyc_documents
      const { data: logoDoc } = await supabase
        .from('kyc_documents')
        .select('file_url')
        .eq('user_id', auction.seller_id)
        .eq('document_type', 'store_logo')
        .single();

      if (auction.seller) {
        (auction.seller as any).store_name = kycApp?.store_name || null;
        (auction.seller as any).store_logo = logoDoc?.file_url || null;
      }
    }

    // Fetch bids
    const { data: bids } = await supabase
      .from('bids')
      .select(`
        bid_id,
        bid_amount,
        status,
        created_at,
        bidder:users!bids_bidder_id_fkey(user_id, name, profile_picture)
      `)
      .eq('auction_id', auctionId)
      .order('bid_amount', { ascending: false })
      .limit(20);

    // Increment view count
    await supabase
      .from('auctions')
      .update({ view_count: (auction.view_count || 0) + 1 })
      .eq('auction_id', auctionId);

    // Get minimum bid
    const minimumBid = await getMinimumBid(auctionId);

    res.json({
      success: true,
      data: {
        ...auction,
        bids: bids || [],
        minimumBid
      }
    });

  } catch (error: any) {
    console.error('❌ Fetch auction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch auction'
    });
  }
});

/**
 * POST /api/auctions/:auctionId/bid
 * Place a bid on an auction
 */
router.post('/:auctionId/bid', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { auctionId } = req.params;
    const bidderId = req.user!.id;
    const { amount, maxAutoBid } = req.body;

    // Check if auction window is open
    const windowStatus = await isAuctionWindowOpen();
    if (!windowStatus.isOpen) {
      return res.status(400).json({
        success: false,
        error: windowStatus.message
      });
    }

    // Fetch auction
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('status', 'active')
      .single();

    if (auctionError || !auction) {
      return res.status(404).json({
        success: false,
        error: 'Auction not found or not active'
      });
    }

    // Check if bidder is the seller
    if (auction.seller_id === bidderId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot bid on your own auction'
      });
    }

    // Check minimum bid
    const minimumBid = await getMinimumBid(auctionId);
    if (amount < minimumBid) {
      return res.status(400).json({
        success: false,
        error: `Bid must be at least ₦${minimumBid.toLocaleString()}`
      });
    }

    // Check buy now
    if (auction.buy_now_price && amount >= auction.buy_now_price) {
      // Instant win!
      const { data: bid, error: bidError } = await supabase
        .from('bids')
        .insert({
          auction_id: auctionId,
          bidder_id: bidderId,
          bid_amount: auction.buy_now_price,
          status: 'won'
        })
        .select()
        .single();

      // Update auction
      await supabase
        .from('auctions')
        .update({
          status: 'awarded',
          winner_id: bidderId,
          winning_bid: auction.buy_now_price,
          current_bid: auction.buy_now_price,
          total_bids: (auction.total_bids || 0) + 1,
          awarded_at: new Date().toISOString()
        })
        .eq('auction_id', auctionId);

      return res.status(201).json({
        success: true,
        data: bid,
        message: 'Congratulations! You won the auction with Buy Now!'
      });
    }

    // Place regular bid
    const { data: bid, error: bidError } = await supabase
      .from('bids')
      .insert({
        auction_id: auctionId,
        bidder_id: bidderId,
        bid_amount: amount,
        is_auto_bid: !!maxAutoBid,
        max_auto_bid: maxAutoBid || null
      })
      .select()
      .single();

    if (bidError) {
      console.error('Bid error:', bidError);
      throw bidError;
    }

    // TODO: Notify previous high bidder they've been outbid
    // TODO: Add to bidder's watchlist automatically

    res.status(201).json({
      success: true,
      data: bid,
      message: 'Bid placed successfully!'
    });

  } catch (error: any) {
    console.error('❌ Place bid error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to place bid'
    });
  }
});

/**
 * GET /api/auctions/user/my-bids
 * Get user's bidding history
 */
router.get('/user/my-bids', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('bids')
      .select(`
        *,
        auction:auctions(
          auction_id,
          title,
          images,
          status,
          current_bid,
          scheduled_end,
          winner_id
        )
      `)
      .eq('bidder_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data || []
    });

  } catch (error: any) {
    console.error('❌ Fetch my bids error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bids'
    });
  }
});

/**
 * POST /api/auctions/:auctionId/watch
 * Add auction to watchlist
 */
router.post('/:auctionId/watch', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { auctionId } = req.params;
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('auction_watchlist')
      .upsert({
        user_id: userId,
        auction_id: auctionId,
        notify_outbid: true,
        notify_ending: true
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data,
      message: 'Added to watchlist'
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Failed to add to watchlist'
    });
  }
});

export default router;