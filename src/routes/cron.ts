// =============================================================
// FILE: src/routes/cron.ts
// Vercel Cron Job Handler for Auction Status Updates
// =============================================================
import express from 'express';
import { supabaseAdmin as supabase } from '../config/supabase';

const router = express.Router();

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get the next Friday at a specific time
 */
const getNextFriday = (hour: number = 12, minute: number = 0): Date => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday
  
  let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  
  if (daysUntilFriday === 0) {
    const fridayTime = new Date(now);
    fridayTime.setHours(hour, minute, 0, 0);
    if (now >= fridayTime) {
      daysUntilFriday = 7;
    }
  }
  
  if (daysUntilFriday === 0 && dayOfWeek !== 5) {
    daysUntilFriday = 7;
  }
  
  const nextFriday = new Date(now);
  nextFriday.setDate(now.getDate() + daysUntilFriday);
  nextFriday.setHours(hour, minute, 0, 0);
  
  return nextFriday;
};

/**
 * Activate scheduled auctions that have reached their start time
 */
const activateScheduledAuctions = async (): Promise<number> => {
  const now = new Date().toISOString();
  
  // Find scheduled auctions where start time has passed
  const { data: auctionsToActivate, error: fetchError } = await supabase
    .from('auctions')
    .select('auction_id, title, scheduled_start')
    .eq('status', 'scheduled')
    .lte('scheduled_start', now);

  if (fetchError) {
    console.error('❌ Error fetching auctions to activate:', fetchError);
    throw fetchError;
  }

  if (!auctionsToActivate || auctionsToActivate.length === 0) {
    return 0;
  }

  // Update status to active
  const auctionIds = auctionsToActivate.map(a => a.auction_id);
  
  const { error: updateError } = await supabase
    .from('auctions')
    .update({ 
      status: 'active',
      updated_at: now
    })
    .in('auction_id', auctionIds);

  if (updateError) {
    console.error('❌ Error activating auctions:', updateError);
    throw updateError;
  }

  console.log(`✅ Activated ${auctionsToActivate.length} auction(s):`, 
    auctionsToActivate.map(a => a.title).join(', '));

  return auctionsToActivate.length;
};

/**
 * End active auctions that have reached their end time
 */
const endActiveAuctions = async (): Promise<number> => {
  const now = new Date().toISOString();
  
  // Find active auctions where end time has passed
  const { data: auctionsToEnd, error: fetchError } = await supabase
    .from('auctions')
    .select('auction_id, title, current_bid, total_bids')
    .eq('status', 'active')
    .lte('scheduled_end', now);

  if (fetchError) {
    console.error('❌ Error fetching auctions to end:', fetchError);
    throw fetchError;
  }

  if (!auctionsToEnd || auctionsToEnd.length === 0) {
    return 0;
  }

  let endedCount = 0;

  for (const auction of auctionsToEnd) {
    try {
      // Determine end status based on whether there were bids
      const endStatus = auction.total_bids > 0 ? 'ended' : 'no_bids';
      
      // Get the winning bid if there were bids
      let winnerId = null;
      let winningBidAmount = null;
      
      if (auction.total_bids > 0) {
        const { data: winningBid } = await supabase
          .from('bids')
          .select('bidder_id, bid_amount, bid_id')
          .eq('auction_id', auction.auction_id)
          .order('bid_amount', { ascending: false })
          .limit(1)
          .single();

        if (winningBid) {
          winnerId = winningBid.bidder_id;
          winningBidAmount = winningBid.bid_amount;
          
          // Update the winning bid status
          await supabase
            .from('bids')
            .update({ status: 'winning' })
            .eq('bid_id', winningBid.bid_id);

          // Mark other bids as outbid
          await supabase
            .from('bids')
            .update({ status: 'outbid' })
            .eq('auction_id', auction.auction_id)
            .neq('bid_id', winningBid.bid_id);
        }
      }

      // Update auction status
      const { error: updateError } = await supabase
        .from('auctions')
        .update({
          status: endStatus,
          winner_id: winnerId,
          winning_bid: winningBidAmount,
          ended_at: now,
          updated_at: now
        })
        .eq('auction_id', auction.auction_id);

      if (updateError) {
        console.error(`❌ Error ending auction ${auction.auction_id}:`, updateError);
        continue;
      }

      console.log(`✅ Ended auction: ${auction.title} | Status: ${endStatus} | Winner: ${winnerId || 'None'}`);
      endedCount++;

    } catch (error) {
      console.error(`❌ Error processing auction ${auction.auction_id}:`, error);
    }
  }

  return endedCount;
};

/**
 * Reschedule auctions that missed their window to next Friday
 */
const rescheduleStaleAuctions = async (): Promise<number> => {
  const now = new Date();
  
  // Find scheduled auctions where both start AND end time have passed
  const { data: staleAuctions, error: fetchError } = await supabase
    .from('auctions')
    .select('auction_id, title, scheduled_start, scheduled_end')
    .eq('status', 'scheduled')
    .lte('scheduled_end', now.toISOString());

  if (fetchError) {
    console.error('❌ Error fetching stale auctions:', fetchError);
    throw fetchError;
  }

  if (!staleAuctions || staleAuctions.length === 0) {
    return 0;
  }

  // Calculate next Friday times
  const nextFridayStart = getNextFriday(12, 0); // 12 PM
  const nextFridayEnd = new Date(nextFridayStart);
  nextFridayEnd.setHours(18, 0, 0, 0); // 6 PM

  // Update all stale auctions to next Friday
  const auctionIds = staleAuctions.map(a => a.auction_id);
  
  const { error: updateError } = await supabase
    .from('auctions')
    .update({
      scheduled_start: nextFridayStart.toISOString(),
      scheduled_end: nextFridayEnd.toISOString(),
      updated_at: now.toISOString()
    })
    .in('auction_id', auctionIds);

  if (updateError) {
    console.error('❌ Error rescheduling auctions:', updateError);
    throw updateError;
  }

  console.log(`✅ Rescheduled ${staleAuctions.length} auction(s) to ${nextFridayStart.toDateString()}:`, 
    staleAuctions.map(a => a.title).join(', '));

  return staleAuctions.length;
};

// ============================================================
// CRON ENDPOINT - Called by Vercel Cron
// ============================================================

/**
 * GET /api/cron/auctions
 * Main cron endpoint - runs all auction status checks
 * 
 * This should be called by Vercel Cron every minute (or as needed)
 * Protected by CRON_SECRET to prevent unauthorized access
 */
router.get('/auctions', async (req, res) => {
  try {
    // Verify cron secret (prevents unauthorized calls)
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized' 
      });
    }

    console.log('🔄 Running auction cron job...');
    const startTime = Date.now();

    // Run all checks
    const activated = await activateScheduledAuctions();
    const ended = await endActiveAuctions();
    const rescheduled = await rescheduleStaleAuctions();

    const duration = Date.now() - startTime;

    console.log(`✅ Cron job completed in ${duration}ms`);

    res.json({
      success: true,
      message: 'Auction cron job completed',
      results: {
        activated,
        ended,
        rescheduled
      },
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Cron job error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Cron job failed'
    });
  }
});

/**
 * POST /api/cron/auctions/activate
 * Manual trigger - activate scheduled auctions
 */
router.post('/auctions/activate', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const count = await activateScheduledAuctions();
    res.json({ success: true, activated: count });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cron/auctions/end
 * Manual trigger - end active auctions
 */
router.post('/auctions/end', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const count = await endActiveAuctions();
    res.json({ success: true, ended: count });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/cron/auctions/reschedule
 * Manual trigger - reschedule stale auctions
 */
router.post('/auctions/reschedule', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const count = await rescheduleStaleAuctions();
    res.json({ success: true, rescheduled: count });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;