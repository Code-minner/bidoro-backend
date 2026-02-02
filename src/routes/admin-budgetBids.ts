// ================================================
// ADMIN BUDGET BIDS/AUCTIONS API ROUTES
// File: src/routes/admin/budgetBids.ts
// ================================================

import { Router, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ================================================
// GET ALL BUDGET BIDS
// ================================================
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { 
      page = '1', 
      limit = '10', 
      search = '', 
      status = '',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build base query
    let query = supabase
      .from('budget_bids')
      .select(`
        *,
        product:products(
          product_id,
          name,
          category_id
        ),
        seller:users!budget_bids_seller_id_fkey(
          user_id,
          name,
          email
        )
      `, { count: 'exact' });

    // Search filter - search in related tables requires different approach
    if (search) {
      // For now, search in the main table fields
      query = query.ilike('id', `%${search}%`);
    }

    // Status filter
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Sorting
    query = query.order(sortBy as string, { ascending: sortOrder === 'asc' });

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: bids, error, count } = await query;

    if (error) {
      // If table doesn't exist, return empty data
      if (error.code === '42P01') {
        return res.json({
          success: true,
          data: {
            bids: [],
            pagination: {
              page: pageNum,
              limit: limitNum,
              total: 0,
              totalPages: 0,
            },
          },
          message: 'Budget bids table not found. Please run the migration.',
        });
      }
      throw error;
    }

    // Get bid counts for each auction
    const bidIds = bids?.map(b => b.id) || [];
    let bidCounts: Record<string, number> = {};
    
    if (bidIds.length > 0) {
      const { data: counts } = await supabase
        .from('budget_bid_entries')
        .select('budget_bid_id')
        .in('budget_bid_id', bidIds);
      
      if (counts) {
        bidCounts = counts.reduce((acc: Record<string, number>, entry: any) => {
          acc[entry.budget_bid_id] = (acc[entry.budget_bid_id] || 0) + 1;
          return acc;
        }, {});
      }
    }

    // Format response
    const formattedBids = bids?.map(bid => ({
      id: bid.id,
      product: {
        id: bid.product?.product_id || bid.product_id,
        name: bid.product?.name || 'Unknown Product',
        image: '/assets/placeholder.png',
        category: bid.product?.category_id || 'Uncategorized',
      },
      seller: {
        id: bid.seller?.user_id || bid.seller_id,
        name: bid.seller?.name || 'Unknown Seller',
        email: bid.seller?.email || '',
      },
      startingPrice: bid.starting_price || 0,
      currentBid: bid.current_bid || bid.starting_price || 0,
      startTime: bid.start_time,
      endTime: bid.end_time,
      totalBids: bidCounts[bid.id] || 0,
      status: bid.status || 'scheduled',
      winnerId: bid.winner_id,
      createdAt: bid.created_at,
    }));

    res.json({
      success: true,
      data: {
        bids: formattedBids || [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching budget bids:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget bids',
      error: error.message,
    });
  }
});

// ================================================
// GET SINGLE BUDGET BID
// ================================================
router.get('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: bid, error } = await supabase
      .from('budget_bids')
      .select(`
        *,
        product:products(product_id, name, category_id),
        seller:users!budget_bids_seller_id_fkey(user_id, name, email),
        winner:users!budget_bids_winner_id_fkey(user_id, name, email)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!bid) {
      return res.status(404).json({
        success: false,
        message: 'Budget bid not found',
      });
    }

    // Get bid entries
    const { data: entries } = await supabase
      .from('budget_bid_entries')
      .select(`
        *,
        bidder:users(user_id, name, email)
      `)
      .eq('budget_bid_id', id)
      .order('amount', { ascending: false });

    res.json({
      success: true,
      data: {
        ...bid,
        entries: entries || [],
      },
    });
  } catch (error: any) {
    console.error('Error fetching budget bid:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch budget bid',
      error: error.message,
    });
  }
});

// ================================================
// END AUCTION EARLY
// ================================================
router.post('/:id/end', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Get the highest bid
    const { data: highestBid } = await supabase
      .from('budget_bid_entries')
      .select('*')
      .eq('budget_bid_id', id)
      .order('amount', { ascending: false })
      .limit(1)
      .single();

    // Update the auction
    const { data: updatedBid, error } = await supabase
      .from('budget_bids')
      .update({
        status: 'ended',
        end_time: new Date().toISOString(),
        winner_id: highestBid?.user_id || null,
        current_bid: highestBid?.amount || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Auction ended successfully',
      data: updatedBid,
    });
  } catch (error: any) {
    console.error('Error ending auction:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end auction',
      error: error.message,
    });
  }
});

// ================================================
// DELETE BUDGET BID
// ================================================
router.delete('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // First delete all bid entries
    await supabase
      .from('budget_bid_entries')
      .delete()
      .eq('budget_bid_id', id);

    // Then delete the bid
    const { error } = await supabase
      .from('budget_bids')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Budget bid deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting budget bid:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete budget bid',
      error: error.message,
    });
  }
});

// ================================================
// GET AUCTION SETTINGS
// ================================================
router.get('/settings/auction', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { data: settings, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'auction_settings')
      .single();

    // Return default settings if none exist
    const defaultSettings = {
      dayOfWeek: 'Sunday',
      startTime: '12:00',
      durationHours: 6,
      nextAuctionDate: getNextAuctionDate('Sunday', '12:00'),
    };

    if (error || !settings) {
      return res.json({
        success: true,
        data: defaultSettings,
      });
    }

    res.json({
      success: true,
      data: settings.value || defaultSettings,
    });
  } catch (error: any) {
    console.error('Error fetching auction settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch auction settings',
      error: error.message,
    });
  }
});

// ================================================
// UPDATE AUCTION SETTINGS
// ================================================
router.put('/settings/auction', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { dayOfWeek, startTime, durationHours } = req.body;

    const nextAuctionDate = getNextAuctionDate(dayOfWeek, startTime);

    const settingsValue = {
      dayOfWeek,
      startTime,
      durationHours,
      nextAuctionDate,
      updatedAt: new Date().toISOString(),
    };

    // Upsert settings
    const { data: settings, error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'auction_settings',
        value: settingsValue,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Auction settings updated successfully',
      data: settingsValue,
    });
  } catch (error: any) {
    console.error('Error updating auction settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update auction settings',
      error: error.message,
    });
  }
});

// ================================================
// GET AUCTION STATISTICS
// ================================================
router.get('/stats/overview', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { data: bids, error } = await supabase
      .from('budget_bids')
      .select('status, current_bid');

    if (error) {
      // Return zeros if table doesn't exist
      return res.json({
        success: true,
        data: {
          total: 0,
          active: 0,
          scheduled: 0,
          ended: 0,
          totalBidValue: 0,
        },
      });
    }

    const stats = {
      total: bids?.length || 0,
      active: bids?.filter(b => b.status === 'active').length || 0,
      scheduled: bids?.filter(b => b.status === 'scheduled').length || 0,
      ended: bids?.filter(b => b.status === 'ended').length || 0,
      totalBidValue: bids?.filter(b => b.status === 'ended')
        .reduce((sum, b) => sum + (b.current_bid || 0), 0) || 0,
    };

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error('Error fetching auction stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch auction statistics',
      error: error.message,
    });
  }
});

// ================================================
// HELPER: Calculate next auction date
// ================================================
function getNextAuctionDate(dayOfWeek: string, startTime: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const targetDay = days.indexOf(dayOfWeek);
  
  const now = new Date();
  const currentDay = now.getDay();
  
  let daysUntilTarget = targetDay - currentDay;
  if (daysUntilTarget <= 0) {
    daysUntilTarget += 7;
  }
  
  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + daysUntilTarget);
  
  const [hours, minutes] = startTime.split(':').map(Number);
  nextDate.setHours(hours, minutes || 0, 0, 0);
  
  return nextDate.toISOString();
}

export default router;