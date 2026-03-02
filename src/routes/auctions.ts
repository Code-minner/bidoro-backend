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
 * Check if auctions are currently open based on auction_settings
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

/**
 * Transition auction statuses based on their schedule.
 * 
 * Lifecycle: scheduled → active → ended/no_bids → awarded → completed
 * 
 * - scheduled → active:  when current time is within [scheduled_start, scheduled_end]
 * - active → ended:      when scheduled_end has passed AND auction has bids
 * - active → no_bids:    when scheduled_end has passed AND auction has 0 bids
 * 
 * Called automatically before fetching auctions so statuses are always up to date.
 */
const transitionAuctionStatuses = async () => {
  const now = new Date().toISOString();

  try {
    // ----------------------------------------------------------------
    // 1. ACTIVATE: scheduled → active
    //    Auctions whose window has started but not yet ended
    // ----------------------------------------------------------------
    const { data: activated, error: activateError } = await supabase
      .from('auctions')
      .update({ status: 'active', actual_start: now })
      .eq('status', 'scheduled')
      .lte('scheduled_start', now)
      .gte('scheduled_end', now)
      .select('auction_id, title');

    if (activateError) {
      console.error('❌ Error activating auctions:', activateError);
    } else if (activated?.length) {
      console.log(`✅ Activated ${activated.length} auction(s):`, activated.map(a => a.title).join(', '));
    }

    // ----------------------------------------------------------------
    // 2. EXPIRE: active → ended OR no_bids
    //    Auctions whose scheduled_end has passed
    // ----------------------------------------------------------------
    const { data: expiredAuctions, error: fetchExpiredError } = await supabase
      .from('auctions')
      .select('auction_id, total_bids')
      .eq('status', 'active')
      .lt('scheduled_end', now);

    if (fetchExpiredError) {
      console.error('❌ Error fetching expired auctions:', fetchExpiredError);
      return;
    }

    if (expiredAuctions?.length) {
      const withBids = expiredAuctions.filter(a => a.total_bids > 0).map(a => a.auction_id);
      const noBids = expiredAuctions.filter(a => a.total_bids === 0).map(a => a.auction_id);

      // Auctions with bids → ended (seller needs to award winner)
      if (withBids.length) {
        const { error: endError } = await supabase
          .from('auctions')
          .update({ status: 'ended' })
          .in('auction_id', withBids);

        if (endError) {
          console.error('❌ Error ending auctions:', endError);
        } else {
          console.log(`🔴 Ended ${withBids.length} auction(s) with bids`);
        }

        // Mark the highest bid on each auction as 'winning'
        for (const auctionId of withBids) {
          const { data: topBid } = await supabase
            .from('bids')
            .select('bid_id')
            .eq('auction_id', auctionId)
            .eq('status', 'active')
            .order('bid_amount', { ascending: false })
            .limit(1)
            .single();

          if (topBid) {
            // Mark all other bids as outbid
            await supabase
              .from('bids')
              .update({ status: 'outbid' })
              .eq('auction_id', auctionId)
              .eq('status', 'active')
              .neq('bid_id', topBid.bid_id);

            // Mark winning bid
            await supabase
              .from('bids')
              .update({ status: 'winning' })
              .eq('bid_id', topBid.bid_id);
          }
        }
      }

      // Auctions without bids → no_bids
      if (noBids.length) {
        const { error: noBidsError } = await supabase
          .from('auctions')
          .update({ status: 'no_bids' })
          .in('auction_id', noBids);

        if (noBidsError) {
          console.error('❌ Error marking no-bid auctions:', noBidsError);
        } else {
          console.log(`⚪ Marked ${noBids.length} auction(s) as no_bids`);
        }
      }

      console.log(`🔄 Transitioned ${expiredAuctions.length} expired auction(s) — ${withBids.length} ended, ${noBids.length} no_bids`);
    }

    // ----------------------------------------------------------------
    // 3. EXPIRE SCHEDULED: scheduled → no_bids
    //    Auctions that were never activated (missed their entire window)
    //    e.g. server was down during the Friday window
    // ----------------------------------------------------------------
    const { data: missedAuctions, error: missedError } = await supabase
      .from('auctions')
      .select('auction_id')
      .eq('status', 'scheduled')
      .lt('scheduled_end', now);

    if (!missedError && missedAuctions?.length) {
      await supabase
        .from('auctions')
        .update({ status: 'no_bids' })
        .in('auction_id', missedAuctions.map(a => a.auction_id));

      console.log(`⚠️ Marked ${missedAuctions.length} missed (never activated) auction(s) as no_bids`);
    }

  } catch (error) {
    console.error('❌ transitionAuctionStatuses error:', error);
  }
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
      productId,
      title,
      description,
      images,
      categoryId,
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

    if (startingPrice <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Starting price must be greater than 0'
      });
    }

    // Price validation
    if (buyNowPrice && buyNowPrice <= startingPrice) {
      return res.status(400).json({
        success: false,
        error: `Buy Now price (₦${buyNowPrice.toLocaleString()}) must be higher than starting price (₦${startingPrice.toLocaleString()})`
      });
    }

    if (reservePrice) {
      if (reservePrice < startingPrice) {
        return res.status(400).json({
          success: false,
          error: `Reserve price (₦${reservePrice.toLocaleString()}) cannot be lower than starting price (₦${startingPrice.toLocaleString()})`
        });
      }

      if (buyNowPrice && reservePrice >= buyNowPrice) {
        return res.status(400).json({
          success: false,
          error: `Reserve price (₦${reservePrice.toLocaleString()}) must be lower than Buy Now price (₦${buyNowPrice.toLocaleString()})`
        });
      }
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

    // Handle category_id
    let finalCategoryId = null;
    if (productData?.category_id) {
      finalCategoryId = productData.category_id;
    } else if (categoryId && isValidUUID(categoryId)) {
      finalCategoryId = categoryId;
    }

    // Calculate scheduled start/end for the next Friday window
    const { data: settings } = await supabase
      .from('auction_settings')
      .select('*')
      .eq('is_active', true)
      .single();

    let scheduledStart = new Date();
    let scheduledEnd = new Date();

    const auctionDay = settings?.auction_day ?? 5; // Friday
    const startHour = settings?.start_time ? parseInt(settings.start_time.split(':')[0]) : 12;
    const startMinute = settings?.start_time ? parseInt(settings.start_time.split(':')[1]) : 0;
    const endHour = settings?.end_time ? parseInt(settings.end_time.split(':')[0]) : 18;
    const endMinute = settings?.end_time ? parseInt(settings.end_time.split(':')[1]) : 0;

    // Calculate days until next auction day
    let daysUntilAuctionDay = (auctionDay - scheduledStart.getDay() + 7) % 7;

    // If today IS the auction day, check if the window has already passed
    if (daysUntilAuctionDay === 0) {
      const currentHour = scheduledStart.getHours();
      const currentMinute = scheduledStart.getMinutes();
      const currentTimeInMinutes = currentHour * 60 + currentMinute;
      const endTimeInMinutes = endHour * 60 + endMinute;

      if (currentTimeInMinutes >= endTimeInMinutes) {
        // Window already passed today, schedule for next week
        daysUntilAuctionDay = 7;
      }
    }

    scheduledStart.setDate(scheduledStart.getDate() + daysUntilAuctionDay);
    scheduledStart.setHours(startHour, startMinute, 0, 0);

    scheduledEnd.setDate(scheduledEnd.getDate() + daysUntilAuctionDay);
    scheduledEnd.setHours(endHour, endMinute, 0, 0);

    // Build images array
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
      message: `Auction scheduled! It will go live on ${scheduledStart.toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric' })} at ${settings?.start_time?.slice(0, 5) || '12:00'}`
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
    const status = req.query.status as string | undefined;

    // Run status transitions so seller sees up-to-date statuses
    await transitionAuctionStatuses();

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
 * PATCH /api/auctions/:auctionId/cancel
 * Cancel an active auction (even with bids - refunds all bidders)
 */
router.patch('/:auctionId/cancel', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { auctionId } = req.params;
    const sellerId = req.user!.id;

    const { data: auction, error: fetchError } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('seller_id', sellerId)
      .in('status', ['scheduled', 'active'])
      .single();

    if (fetchError || !auction) {
      return res.status(404).json({
        success: false,
        error: 'Auction not found or cannot be cancelled'
      });
    }

    // Cancel the auction
    const { error: updateError } = await supabase
      .from('auctions')
      .update({ status: 'cancelled' })
      .eq('auction_id', auctionId);

    if (updateError) throw updateError;

    // Cancel all active bids
    await supabase
      .from('bids')
      .update({ status: 'cancelled' })
      .eq('auction_id', auctionId)
      .in('status', ['active', 'winning']);

    // TODO: Notify all bidders that the auction was cancelled

    res.json({
      success: true,
      message: 'Auction cancelled successfully'
    });

  } catch (error: any) {
    console.error('❌ Cancel auction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel auction'
    });
  }
});

/**
 * PATCH /api/auctions/:auctionId/relist
 * Relist an ended/no_bids auction for the next Friday window
 */
router.patch('/:auctionId/relist', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { auctionId } = req.params;
    const sellerId = req.user!.id;

    const { data: auction, error: fetchError } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('seller_id', sellerId)
      .in('status', ['no_bids', 'cancelled', 'ended'])
      .single();

    if (fetchError || !auction) {
      return res.status(404).json({
        success: false,
        error: 'Auction not found or cannot be relisted'
      });
    }

    // If 'ended' with bids, don't allow relist (must award first or it should be no_bids)
    if (auction.status === 'ended' && auction.total_bids > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot relist an auction with bids. Please award the winner first.'
      });
    }

    // Calculate next Friday window
    const { data: settings } = await supabase
      .from('auction_settings')
      .select('*')
      .eq('is_active', true)
      .single();

    const now = new Date();
    const auctionDay = settings?.auction_day ?? 5;
    const startHour = settings?.start_time ? parseInt(settings.start_time.split(':')[0]) : 12;
    const startMinute = settings?.start_time ? parseInt(settings.start_time.split(':')[1]) : 0;
    const endHour = settings?.end_time ? parseInt(settings.end_time.split(':')[0]) : 18;
    const endMinute = settings?.end_time ? parseInt(settings.end_time.split(':')[1]) : 0;

    let daysUntilAuctionDay = (auctionDay - now.getDay() + 7) % 7;
    if (daysUntilAuctionDay === 0) {
      const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
      const endTimeInMinutes = endHour * 60 + endMinute;
      if (currentTimeInMinutes >= endTimeInMinutes) {
        daysUntilAuctionDay = 7;
      }
    }

    const newStart = new Date(now);
    newStart.setDate(now.getDate() + daysUntilAuctionDay);
    newStart.setHours(startHour, startMinute, 0, 0);

    const newEnd = new Date(now);
    newEnd.setDate(now.getDate() + daysUntilAuctionDay);
    newEnd.setHours(endHour, endMinute, 0, 0);

    const { data: updated, error: updateError } = await supabase
      .from('auctions')
      .update({
        status: 'scheduled',
        scheduled_start: newStart.toISOString(),
        scheduled_end: newEnd.toISOString(),
        actual_start: null,
        current_bid: null,
        total_bids: 0,
        winner_id: null,
        winning_bid: null,
        awarded_at: null
      })
      .eq('auction_id', auctionId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      success: true,
      data: updated,
      message: `Auction relisted! It will go live on ${newStart.toLocaleDateString('en-NG', { weekday: 'long', month: 'short', day: 'numeric' })} at ${settings?.start_time?.slice(0, 5) || '12:00'}`
    });

  } catch (error: any) {
    console.error('❌ Relist auction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to relist auction'
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

    const { data: auction, error: fetchError } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('seller_id', sellerId)
      .eq('status', 'ended')
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
    // Transition statuses before fetching so results are always current
    await transitionAuctionStatuses();

    const category = req.query.category as string | undefined;
    const minPrice = req.query.minPrice as string | undefined;
    const maxPrice = req.query.maxPrice as string | undefined;
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const page = (req.query.page as string) || '1';
    const limit = (req.query.limit as string) || '20';

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
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
      query = query.gte('starting_price', parseFloat(minPrice));
    }
    if (maxPrice) {
      query = query.lte('starting_price', parseFloat(maxPrice));
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

    // Run transitions so this auction's status is current
    await transitionAuctionStatuses();

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
      const { data: kycApp } = await supabase
        .from('kyc_applications')
        .select('store_name')
        .eq('user_id', auction.seller_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

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
    const auctionId = req.params.auctionId as string;
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

    // Fetch auction — must be active
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('*')
      .eq('auction_id', auctionId)
      .eq('status', 'active')
      .single();

    if (auctionError || !auction) {
      return res.status(404).json({
        success: false,
        error: 'Auction not found or not currently active'
      });
    }

    // Cannot bid on own auction
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

    // Check buy now — instant win
    if (auction.buy_now_price && amount >= auction.buy_now_price) {
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

      if (bidError) throw bidError;

      // Mark all other active bids as outbid
      await supabase
        .from('bids')
        .update({ status: 'outbid' })
        .eq('auction_id', auctionId)
        .eq('status', 'active')
        .neq('bid_id', bid.bid_id);

      // Update auction as awarded
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

    // Mark previous highest bid as outbid
    if (auction.current_bid) {
      await supabase
        .from('bids')
        .update({ status: 'outbid' })
        .eq('auction_id', auctionId)
        .eq('status', 'active')
        .lt('bid_amount', amount);
    }

    // Place regular bid
    const { data: bid, error: bidError } = await supabase
      .from('bids')
      .insert({
        auction_id: auctionId,
        bidder_id: bidderId,
        bid_amount: amount,
        is_auto_bid: !!maxAutoBid,
        max_auto_bid: maxAutoBid || null,
        status: 'active'
      })
      .select()
      .single();

    if (bidError) {
      console.error('Bid error:', bidError);
      throw bidError;
    }

    // Update auction current_bid and total
    await supabase
      .from('auctions')
      .update({
        current_bid: amount,
        total_bids: (auction.total_bids || 0) + 1
      })
      .eq('auction_id', auctionId);

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

/**
 * GET /api/auctions/user/watchlist
 * Get user's auction watchlist with full auction details
 */
router.get('/user/watchlist', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('auction_watchlist')
      .select(`
        id,
        auction_id,
        notify_outbid,
        notify_ending,
        created_at,
        auction:auctions(
          auction_id,
          title,
          images,
          starting_price,
          current_bid,
          buy_now_price,
          status,
          total_bids,
          scheduled_start,
          scheduled_end,
          categories(name, slug)
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const validItems = data?.filter(item => item.auction !== null) || [];

    res.json({
      success: true,
      data: validItems,
      count: validItems.length
    });

  } catch (error: any) {
    console.error('❌ Fetch auction watchlist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch watchlist'
    });
  }
});

/**
 * DELETE /api/auctions/:auctionId/unwatch
 * Remove auction from watchlist
 */
router.delete('/:auctionId/unwatch', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { auctionId } = req.params;
    const userId = req.user!.id;

    const { error } = await supabase
      .from('auction_watchlist')
      .delete()
      .eq('user_id', userId)
      .eq('auction_id', auctionId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Removed from watchlist'
    });

  } catch (error: any) {
    console.error('❌ Remove from watchlist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove from watchlist'
    });
  }
});

/**
 * GET /api/auctions/user/watchlist/ids
 * Get list of auction IDs in user's watchlist (for quick checking)
 */
router.get('/user/watchlist/ids', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('auction_watchlist')
      .select('auction_id')
      .eq('user_id', userId);

    if (error) throw error;

    const auctionIds = data?.map(item => item.auction_id) || [];

    res.json({
      success: true,
      data: auctionIds
    });

  } catch (error: any) {
    console.error('❌ Fetch watchlist IDs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch watchlist'
    });
  }
});

/**
 * GET /api/auctions/user/watchlist/check/:auctionId
 * Check if auction is in user's watchlist
 */
router.get('/user/watchlist/check/:auctionId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { auctionId } = req.params;

    const { data, error } = await supabase
      .from('auction_watchlist')
      .select('id')
      .eq('user_id', userId)
      .eq('auction_id', auctionId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    res.json({
      success: true,
      inWatchlist: !!data
    });

  } catch (error: any) {
    console.error('❌ Check watchlist error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check watchlist'
    });
  }
});

export default router;