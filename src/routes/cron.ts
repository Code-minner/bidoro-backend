// =============================================================
// FILE: src/routes/cron.ts
// Vercel Cron Job Handler for Auctions + Escrow
// =============================================================
import express from 'express';
import { supabaseAdmin as supabase } from '../config/supabase';
import {
  processAutoReleases,
  reconcileMissingEscrows,
  sendDeliveryReminders,
  retryFailedPayouts,
  syncStatusCheck,
} from '../services/escrowCron';

const router = express.Router();

// ============================================================
// CRON AUTH HELPER
// ============================================================
const verifyCronAuth = (req: express.Request): boolean => {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) return false;
  return true;
};

// ============================================================
// AUCTION HELPERS (unchanged)
// ============================================================

const getNextFriday = (hour: number = 12, minute: number = 0): Date => {
  const now = new Date();
  const dayOfWeek = now.getDay();
  let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  
  if (daysUntilFriday === 0) {
    const fridayTime = new Date(now);
    fridayTime.setHours(hour, minute, 0, 0);
    if (now >= fridayTime) daysUntilFriday = 7;
  }
  if (daysUntilFriday === 0 && dayOfWeek !== 5) daysUntilFriday = 7;
  
  const nextFriday = new Date(now);
  nextFriday.setDate(now.getDate() + daysUntilFriday);
  nextFriday.setHours(hour, minute, 0, 0);
  return nextFriday;
};

const activateScheduledAuctions = async (): Promise<number> => {
  const now = new Date().toISOString();
  const { data: auctionsToActivate, error: fetchError } = await supabase
    .from('auctions')
    .select('auction_id, title, scheduled_start')
    .eq('status', 'scheduled')
    .lte('scheduled_start', now);

  if (fetchError) { console.error('❌ Error fetching auctions to activate:', fetchError); throw fetchError; }
  if (!auctionsToActivate || auctionsToActivate.length === 0) return 0;

  const auctionIds = auctionsToActivate.map(a => a.auction_id);
  const { error: updateError } = await supabase
    .from('auctions')
    .update({ status: 'active', updated_at: now })
    .in('auction_id', auctionIds);

  if (updateError) { console.error('❌ Error activating auctions:', updateError); throw updateError; }
  console.log(`✅ Activated ${auctionsToActivate.length} auction(s):`, auctionsToActivate.map(a => a.title).join(', '));
  return auctionsToActivate.length;
};

const endActiveAuctions = async (): Promise<number> => {
  const now = new Date().toISOString();
  const { data: auctionsToEnd, error: fetchError } = await supabase
    .from('auctions')
    .select('auction_id, title, current_bid, total_bids')
    .eq('status', 'active')
    .lte('scheduled_end', now);

  if (fetchError) { console.error('❌ Error fetching auctions to end:', fetchError); throw fetchError; }
  if (!auctionsToEnd || auctionsToEnd.length === 0) return 0;

  let endedCount = 0;
  for (const auction of auctionsToEnd) {
    try {
      const endStatus = auction.total_bids > 0 ? 'ended' : 'no_bids';
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
          await supabase.from('bids').update({ status: 'winning' }).eq('bid_id', winningBid.bid_id);
          await supabase.from('bids').update({ status: 'outbid' }).eq('auction_id', auction.auction_id).neq('bid_id', winningBid.bid_id);
        }
      }

      const { error: updateError } = await supabase
        .from('auctions')
        .update({ status: endStatus, winner_id: winnerId, winning_bid: winningBidAmount, ended_at: now, updated_at: now })
        .eq('auction_id', auction.auction_id);

      if (updateError) { console.error(`❌ Error ending auction ${auction.auction_id}:`, updateError); continue; }
      console.log(`✅ Ended auction: ${auction.title} | Status: ${endStatus} | Winner: ${winnerId || 'None'}`);
      endedCount++;
    } catch (error) {
      console.error(`❌ Error processing auction ${auction.auction_id}:`, error);
    }
  }
  return endedCount;
};

const rescheduleStaleAuctions = async (): Promise<number> => {
  const now = new Date();
  const { data: staleAuctions, error: fetchError } = await supabase
    .from('auctions')
    .select('auction_id, title, scheduled_start, scheduled_end')
    .eq('status', 'scheduled')
    .lte('scheduled_end', now.toISOString());

  if (fetchError) { console.error('❌ Error fetching stale auctions:', fetchError); throw fetchError; }
  if (!staleAuctions || staleAuctions.length === 0) return 0;

  const nextFridayStart = getNextFriday(12, 0);
  const nextFridayEnd = new Date(nextFridayStart);
  nextFridayEnd.setHours(18, 0, 0, 0);

  const auctionIds = staleAuctions.map(a => a.auction_id);
  const { error: updateError } = await supabase
    .from('auctions')
    .update({ scheduled_start: nextFridayStart.toISOString(), scheduled_end: nextFridayEnd.toISOString(), updated_at: now.toISOString() })
    .in('auction_id', auctionIds);

  if (updateError) { console.error('❌ Error rescheduling auctions:', updateError); throw updateError; }
  console.log(`✅ Rescheduled ${staleAuctions.length} auction(s) to ${nextFridayStart.toDateString()}`);
  return staleAuctions.length;
};

// ============================================================
// AUCTION CRON ENDPOINTS (unchanged)
// ============================================================

router.get('/auctions', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    console.log('🔄 Running auction cron job...');
    const startTime = Date.now();
    const activated = await activateScheduledAuctions();
    const ended = await endActiveAuctions();
    const rescheduled = await rescheduleStaleAuctions();
    const duration = Date.now() - startTime;
    console.log(`✅ Auction cron completed in ${duration}ms`);
    res.json({ success: true, message: 'Auction cron job completed', results: { activated, ended, rescheduled }, duration: `${duration}ms`, timestamp: new Date().toISOString() });
  } catch (error: any) {
    console.error('❌ Auction cron error:', error);
    res.status(500).json({ success: false, error: error.message || 'Cron job failed' });
  }
});

router.post('/auctions/activate', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const count = await activateScheduledAuctions();
    res.json({ success: true, activated: count });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/auctions/end', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const count = await endActiveAuctions();
    res.json({ success: true, ended: count });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

router.post('/auctions/reschedule', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const count = await rescheduleStaleAuctions();
    res.json({ success: true, rescheduled: count });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

// ============================================================
// ESCROW CRON ENDPOINTS (NEW)
// ============================================================

/**
 * GET /api/cron/escrow
 * Main escrow cron — runs all escrow maintenance jobs
 * Schedule: every 1 hour on Vercel
 */
router.get('/escrow', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });

    console.log('🔄 Running escrow cron job...');
    const startTime = Date.now();

    // Run all escrow jobs
    const [autoRelease, reconcile, reminders, retries, statusSync] = await Promise.allSettled([
      processAutoReleases(),
      reconcileMissingEscrows(),
      sendDeliveryReminders(),
      retryFailedPayouts(),
      syncStatusCheck(),
    ]);

    const duration = Date.now() - startTime;
    console.log(`✅ Escrow cron completed in ${duration}ms`);

    res.json({
      success: true,
      message: 'Escrow cron job completed',
      results: {
        autoRelease: autoRelease.status === 'fulfilled' ? autoRelease.value : { error: (autoRelease as any).reason?.message },
        reconcile: reconcile.status === 'fulfilled' ? reconcile.value : { error: (reconcile as any).reason?.message },
        reminders: reminders.status === 'fulfilled' ? reminders.value : { error: (reminders as any).reason?.message },
        retries: retries.status === 'fulfilled' ? retries.value : { error: (retries as any).reason?.message },
        statusSync: statusSync.status === 'fulfilled' ? statusSync.value : { error: (statusSync as any).reason?.message },
      },
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('❌ Escrow cron error:', error);
    res.status(500).json({ success: false, error: error.message || 'Escrow cron failed' });
  }
});

/**
 * POST /api/cron/escrow/auto-release
 * Manual trigger — release escrows past auto_release_at
 */
router.post('/escrow/auto-release', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const result = await processAutoReleases();
    res.json({ success: true, ...result });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

/**
 * POST /api/cron/escrow/reconcile
 * Manual trigger — create missing escrow records for paid orders
 */
router.post('/escrow/reconcile', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const result = await reconcileMissingEscrows();
    res.json({ success: true, ...result });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

/**
 * POST /api/cron/escrow/retry-payouts
 * Manual trigger — retry failed seller payouts
 */
router.post('/escrow/retry-payouts', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const result = await retryFailedPayouts();
    res.json({ success: true, ...result });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

/**
 * POST /api/cron/escrow/sync-status
 * Manual trigger — fix drift between orders and escrow tables
 */
router.post('/escrow/sync-status', async (req, res) => {
  try {
    if (!verifyCronAuth(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const result = await syncStatusCheck();
    res.json({ success: true, ...result });
  } catch (error: any) { res.status(500).json({ success: false, error: error.message }); }
});

export default router;