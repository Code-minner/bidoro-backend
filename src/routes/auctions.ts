import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { supabaseAdmin as supabase } from '../config/supabase';

const router = express.Router();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

const isValidUUID = (str: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

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
  const currentDay = now.getDay();
  const currentTime = now.toTimeString().slice(0, 8);

  const isCorrectDay = currentDay === settings.auction_day;
  const isWithinTime = currentTime >= settings.start_time && currentTime <= settings.end_time;

  if (isCorrectDay && isWithinTime) {
    return { isOpen: true, message: 'Auctions are open!' };
  }

  let daysUntilNext = (settings.auction_day - currentDay + 7) % 7;
  if (daysUntilNext === 0 && currentTime > settings.end_time) {
    daysUntilNext = 7;
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

const transitionAuctionStatuses = async () => {
  const now = new Date().toISOString();

  try {
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
            await supabase
              .from('bids')
              .update({ status: 'outbid' })
              .eq('auction_id', auctionId)
              .eq('status', 'active')
              .neq('bid_id', topBid.bid_id);

            await supabase
              .from('bids')
              .update({ status: 'winning' })
              .eq('bid_id', topBid.bid_id);
          }
        }
      }

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

    let finalCategoryId = null;
    if (productData?.category_id) {
      finalCategoryId = productData.category_id;
    } else if (categoryId && isValidUUID(categoryId)) {
      finalCategoryId = categoryId;
    }

    const { data: settings } = await supabase
      .from('auction_settings')
      .select('*')
      .eq('is_active', true)
      .single();

    let scheduledStart = new Date();
    let scheduledEnd = new Date();

    const auctionDay = settings?.auction_day ?? 5;
    const startHour = settings?.start_time ? parseInt(settings.start_time.split(':')[0]) : 12;
    const startMinute = settings?.start_time ? parseInt(settings.start_time.split(':')[1]) : 0;
    const endHour = settings?.end_time ? parseInt(settings.end_time.split(':')[0]) : 18;
    const endMinute = settings?.end_time ? parseInt(settings.end_time.split(':')[1]) : 0;

    let daysUntilAuctionDay = (auctionDay - scheduledStart.getDay() + 7) % 7;

    if (daysUntilAuctionDay === 0) {
      const currentHour = scheduledStart.getHours();
      const currentMinute = scheduledStart.getMinutes();
      const currentTimeInMinutes = currentHour * 60 + currentMinute;
      const endTimeInMinutes = endHour * 60 + endMinute;

      if (currentTimeInMinutes >= endTimeInMinutes) {
        daysUntilAuctionDay = 7;
      }
    }

    scheduledStart.setDate(scheduledStart.getDate() + daysUntilAuctionDay);
    scheduledStart.setHours(startHour, startMinute, 0, 0);

    scheduledEnd.setDate(scheduledEnd.getDate() + daysUntilAuctionDay);
    scheduledEnd.setHours(endHour, endMinute, 0, 0);

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

router.get('/my-auctions', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sellerId = req.user!.id;
    const status = req.query.status as string | undefined;

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

    const { error: updateError } = await supabase
      .from('auctions')
      .update({ status: 'cancelled' })
      .eq('auction_id', auctionId);

    if (updateError) throw updateError;

    await supabase
      .from('bids')
      .update({ status: 'cancelled' })
      .eq('auction_id', auctionId)
      .in('status', ['active', 'winning']);

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

    if (auction.status === 'ended' && auction.total_bids > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot relist an auction with bids. Please award the winner first.'
      });
    }

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

    await supabase
      .from('bids')
      .update({ status: 'won' })
      .eq('bid_id', winningBid.bid_id);

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

router.get('/', async (req, res) => {
  try {
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

    if (status === 'active') {
      query = query.eq('status', 'active');
    } else if (status === 'upcoming') {
      query = query.eq('status', 'scheduled');
    } else if (status === 'ended') {
      query = query.in('status', ['ended', 'awarded', 'completed']);
    } else {
      query = query.in('status', ['active', 'scheduled']);
    }

    if (category) query = query.eq('category_id', category);
    if (minPrice) query = query.gte('starting_price', parseFloat(minPrice));
    if (maxPrice) query = query.lte('starting_price', parseFloat(maxPrice));
    if (search) query = query.ilike('title', `%${search}%`);

    const { data, error, count } = await query;

    if (error) throw error;

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

router.get('/:auctionId', async (req, res) => {
  try {
    const { auctionId } = req.params;

    await transitionAuctionStatuses();

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

    await supabase
      .from('auctions')
      .update({ view_count: (auction.view_count || 0) + 1 })
      .eq('auction_id', auctionId);

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

router.post('/:auctionId/bid', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const auctionId = req.params.auctionId as string;
    const bidderId = req.user!.id;
    const { amount, maxAutoBid } = req.body;

    const windowStatus = await isAuctionWindowOpen();
    if (!windowStatus.isOpen) {
      return res.status(400).json({
        success: false,
        error: windowStatus.message
      });
    }

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

    if (auction.seller_id === bidderId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot bid on your own auction'
      });
    }

    const minimumBid = await getMinimumBid(auctionId);
    if (amount < minimumBid) {
      return res.status(400).json({
        success: false,
        error: `Bid must be at least ₦${minimumBid.toLocaleString()}`
      });
    }

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

      await supabase
        .from('bids')
        .update({ status: 'outbid' })
        .eq('auction_id', auctionId)
        .eq('status', 'active')
        .neq('bid_id', bid.bid_id);

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

    if (auction.current_bid) {
      await supabase
        .from('bids')
        .update({ status: 'outbid' })
        .eq('auction_id', auctionId)
        .eq('status', 'active')
        .lt('bid_amount', amount);
    }

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

    await supabase
      .from('auctions')
      .update({
        current_bid: amount,
        total_bids: (auction.total_bids || 0) + 1
      })
      .eq('auction_id', auctionId);

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

// ============================================================
// ADD AUCTION WIN TO CART
// ============================================================

/**
 * POST /api/auctions/:auctionId/add-to-cart
 * Winner adds their auction item to cart for normal checkout
 */
router.post(
  '/:auctionId/add-to-cart',
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const { auctionId } = req.params;

      // 1. Fetch auction
      const { data: auction, error: auctionError } = await supabase
        .from('auctions')
        .select('*')
        .eq('auction_id', auctionId)
        .single();

      if (auctionError || !auction) {
        return res.status(404).json({
          success: false,
          message: 'Auction not found',
        });
      }

      // 2. Only the winner can add to cart
      if (auction.winner_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You are not the winner of this auction',
        });
      }

      // 3. Auction must be ended or awarded
      if (!['awarded', 'ended'].includes(auction.status)) {
        return res.status(400).json({
          success: false,
          message: 'This auction is not ready for checkout',
        });
      }

      // 4. Check if already in cart
      const { data: existing } = await supabase
        .from('cart_items')
        .select('id')
        .eq('user_id', userId)
        .eq('auction_id', auctionId)
        .maybeSingle();

      if (existing) {
        return res.json({
          success: true,
          message: 'Auction item already in cart',
          data: { alreadyInCart: true },
        });
      }

      // 5. Check if already paid
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('order_id, payment_status')
        .eq('auction_id', auctionId)
        .eq('buyer_id', userId)
        .eq('payment_status', 'paid')
        .maybeSingle();

      if (existingOrder) {
        return res.status(400).json({
          success: false,
          message: "You've already paid for this auction",
        });
      }

      // 6. Add to cart with winning bid as override_price
      const winningBid = auction.winning_bid || auction.current_bid || auction.starting_price;

      const { data: cartItem, error: cartError } = await supabase
        .from('cart_items')
        .insert({
          user_id: userId,
          product_id: auction.product_id,
          quantity: 1,
          auction_id: auctionId,
          override_price: winningBid,
        })
        .select()
        .single();

      if (cartError) throw cartError;

      // Get updated cart count
      const { count } = await supabase
        .from('cart_items')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      res.status(201).json({
        success: true,
        message: 'Auction item added to cart',
        data: {
          cartItem,
          cartCount: count || 0,
          winningBid,
        },
      });
    } catch (error: any) {
      console.error('Add auction to cart error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to add auction item to cart',
      });
    }
  }
);

export default router;