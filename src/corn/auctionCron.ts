// // =============================================================
// // FILE: src/cron/auctionCron.ts
// // =============================================================
// import cron from 'node-cron';
// import { supabaseAdmin as supabase } from '../config/supabase';

// /**
//  * Auction Status Management Cron Jobs
//  * 
//  * This module handles automatic auction status transitions:
//  * - scheduled → active (when start time is reached)
//  * - active → ended (when end time is reached)
//  * - Reschedules auctions that missed their window to next Friday
//  */

// // ============================================================
// // HELPER FUNCTIONS
// // ============================================================

// /**
//  * Get the next Friday at a specific time
//  */
// const getNextFriday = (hour: number = 12, minute: number = 0): Date => {
//   const now = new Date();
//   const dayOfWeek = now.getDay(); // 0 = Sunday, 5 = Friday
  
//   let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  
//   if (daysUntilFriday === 0) {
//     const fridayTime = new Date(now);
//     fridayTime.setHours(hour, minute, 0, 0);
//     if (now >= fridayTime) {
//       daysUntilFriday = 7;
//     }
//   }
  
//   if (daysUntilFriday === 0 && dayOfWeek !== 5) {
//     daysUntilFriday = 7;
//   }
  
//   const nextFriday = new Date(now);
//   nextFriday.setDate(now.getDate() + daysUntilFriday);
//   nextFriday.setHours(hour, minute, 0, 0);
  
//   return nextFriday;
// };

// /**
//  * Activate scheduled auctions that have reached their start time
//  */
// const activateScheduledAuctions = async () => {
//   try {
//     const now = new Date().toISOString();
    
//     // Find scheduled auctions where start time has passed
//     const { data: auctionsToActivate, error: fetchError } = await supabase
//       .from('auctions')
//       .select('auction_id, title, scheduled_start')
//       .eq('status', 'scheduled')
//       .lte('scheduled_start', now);

//     if (fetchError) {
//       console.error('❌ Error fetching auctions to activate:', fetchError);
//       return;
//     }

//     if (!auctionsToActivate || auctionsToActivate.length === 0) {
//       return; // No auctions to activate
//     }

//     // Update status to active
//     const auctionIds = auctionsToActivate.map(a => a.auction_id);
    
//     const { error: updateError } = await supabase
//       .from('auctions')
//       .update({ 
//         status: 'active',
//         updated_at: now
//       })
//       .in('auction_id', auctionIds);

//     if (updateError) {
//       console.error('❌ Error activating auctions:', updateError);
//       return;
//     }

//     console.log(`✅ Activated ${auctionsToActivate.length} auction(s):`, 
//       auctionsToActivate.map(a => a.title).join(', '));

//     // TODO: Send notifications to watchers that auction is now live

//   } catch (error) {
//     console.error('❌ Error in activateScheduledAuctions:', error);
//   }
// };

// /**
//  * End active auctions that have reached their end time
//  */
// const endActiveAuctions = async () => {
//   try {
//     const now = new Date().toISOString();
    
//     // Find active auctions where end time has passed
//     const { data: auctionsToEnd, error: fetchError } = await supabase
//       .from('auctions')
//       .select('auction_id, title, current_bid, total_bids')
//       .eq('status', 'active')
//       .lte('scheduled_end', now);

//     if (fetchError) {
//       console.error('❌ Error fetching auctions to end:', fetchError);
//       return;
//     }

//     if (!auctionsToEnd || auctionsToEnd.length === 0) {
//       return; // No auctions to end
//     }

//     for (const auction of auctionsToEnd) {
//       // Determine end status based on whether there were bids
//       const endStatus = auction.total_bids > 0 ? 'ended' : 'no_bids';
      
//       // Get the winning bid if there were bids
//       let winnerId = null;
//       let winningBidAmount = null;
      
//       if (auction.total_bids > 0) {
//         const { data: winningBid } = await supabase
//           .from('bids')
//           .select('bidder_id, bid_amount')
//           .eq('auction_id', auction.auction_id)
//           .order('bid_amount', { ascending: false })
//           .limit(1)
//           .single();

//         if (winningBid) {
//           winnerId = winningBid.bidder_id;
//           winningBidAmount = winningBid.bid_amount;
          
//           // Update the winning bid status
//           await supabase
//             .from('bids')
//             .update({ status: 'winning' })
//             .eq('auction_id', auction.auction_id)
//             .eq('bid_amount', winningBidAmount);

//           // Mark other bids as outbid
//           await supabase
//             .from('bids')
//             .update({ status: 'outbid' })
//             .eq('auction_id', auction.auction_id)
//             .neq('bid_amount', winningBidAmount);
//         }
//       }

//       // Update auction status
//       const { error: updateError } = await supabase
//         .from('auctions')
//         .update({
//           status: endStatus,
//           winner_id: winnerId,
//           winning_bid: winningBidAmount,
//           ended_at: now,
//           updated_at: now
//         })
//         .eq('auction_id', auction.auction_id);

//       if (updateError) {
//         console.error(`❌ Error ending auction ${auction.auction_id}:`, updateError);
//         continue;
//       }

//       console.log(`✅ Ended auction: ${auction.title} | Status: ${endStatus} | Winner: ${winnerId || 'None'}`);

//       // TODO: Send notifications
//       // - Notify seller that auction ended
//       // - Notify winner (if any) that they won
//       // - Notify other bidders that they didn't win
//     }

//   } catch (error) {
//     console.error('❌ Error in endActiveAuctions:', error);
//   }
// };

// /**
//  * Reschedule auctions that missed their window to next Friday
//  * This handles cases where auctions were scheduled but the system was down
//  */
// const rescheduleStaleAuctions = async () => {
//   try {
//     const now = new Date();
    
//     // Find scheduled auctions where both start AND end time have passed
//     // These missed their entire window and need to be rescheduled
//     const { data: staleAuctions, error: fetchError } = await supabase
//       .from('auctions')
//       .select('auction_id, title, scheduled_start, scheduled_end')
//       .eq('status', 'scheduled')
//       .lte('scheduled_end', now.toISOString());

//     if (fetchError) {
//       console.error('❌ Error fetching stale auctions:', fetchError);
//       return;
//     }

//     if (!staleAuctions || staleAuctions.length === 0) {
//       return; // No stale auctions
//     }

//     // Calculate next Friday times
//     const nextFridayStart = getNextFriday(12, 0); // 12 PM
//     const nextFridayEnd = new Date(nextFridayStart);
//     nextFridayEnd.setHours(18, 0, 0, 0); // 6 PM

//     // Update all stale auctions to next Friday
//     const auctionIds = staleAuctions.map(a => a.auction_id);
    
//     const { error: updateError } = await supabase
//       .from('auctions')
//       .update({
//         scheduled_start: nextFridayStart.toISOString(),
//         scheduled_end: nextFridayEnd.toISOString(),
//         updated_at: now.toISOString()
//       })
//       .in('auction_id', auctionIds);

//     if (updateError) {
//       console.error('❌ Error rescheduling auctions:', updateError);
//       return;
//     }

//     console.log(`✅ Rescheduled ${staleAuctions.length} auction(s) to ${nextFridayStart.toDateString()}:`, 
//       staleAuctions.map(a => a.title).join(', '));

//     // TODO: Notify sellers that their auction was rescheduled

//   } catch (error) {
//     console.error('❌ Error in rescheduleStaleAuctions:', error);
//   }
// };

// // ============================================================
// // CRON JOB SETUP
// // ============================================================

// /**
//  * Initialize all auction cron jobs
//  */
// export const initAuctionCronJobs = () => {
//   console.log('🕐 Initializing auction cron jobs...');

//   // Run every minute to check for status changes
//   // In production, you might want to run this every 30 seconds on Fridays
//   cron.schedule('* * * * *', async () => {
//     await activateScheduledAuctions();
//     await endActiveAuctions();
//   }, {
//     timezone: 'Africa/Lagos' // Nigerian timezone
//   });

//   // Run daily at midnight to reschedule any stale auctions
//   cron.schedule('0 0 * * *', async () => {
//     console.log('🔄 Running daily auction maintenance...');
//     await rescheduleStaleAuctions();
//   }, {
//     timezone: 'Africa/Lagos'
//   });

//   // Optional: Run more frequently on Fridays (auction day)
//   // This runs every 30 seconds on Fridays between 11:55 AM and 6:05 PM
//   cron.schedule('*/30 * * * 5', async () => {
//     const now = new Date();
//     const hour = now.getHours();
//     const minute = now.getMinutes();
    
//     // Only run between 11:55 AM and 6:05 PM
//     if ((hour === 11 && minute >= 55) || (hour >= 12 && hour < 18) || (hour === 18 && minute <= 5)) {
//       await activateScheduledAuctions();
//       await endActiveAuctions();
//     }
//   }, {
//     timezone: 'Africa/Lagos'
//   });

//   console.log('✅ Auction cron jobs initialized');
// };

// /**
//  * Manual trigger functions for testing/admin use
//  */
// export const manualTriggers = {
//   activateScheduledAuctions,
//   endActiveAuctions,
//   rescheduleStaleAuctions,
  
//   // Run all checks at once
//   runAllChecks: async () => {
//     console.log('🔄 Running all auction checks manually...');
//     await activateScheduledAuctions();
//     await endActiveAuctions();
//     await rescheduleStaleAuctions();
//     console.log('✅ All checks complete');
//   }
// };

// export default initAuctionCronJobs;