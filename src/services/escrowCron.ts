// src/services/escrowCron.ts
// Add these functions to your existing cron setup

import { escrowService } from './escrowService';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Process auto-releases for escrows past their auto_release_at date
 * Call this from your cron route (every hour recommended)
 */
export const processAutoReleases = async () => {
  console.log('[ESCROW CRON] Processing auto-releases...');
  
  try {
    const result = await escrowService.processAutoReleases();
    console.log(`[ESCROW CRON] Auto-released ${result.processed} escrows`);
    return { success: true, processed: result.processed };
  } catch (error) {
    console.error('[ESCROW CRON] Auto-release error:', error);
    return { success: false, error: 'Auto-release failed' };
  }
};

/**
 * Send reminder notifications for escrows approaching auto-release
 * (3 days after payment, 2 days before auto-release)
 * Call this from your cron route (every 6 hours recommended)
 */
export const sendDeliveryReminders = async () => {
  console.log('[ESCROW CRON] Checking for delivery reminders...');
  
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data: escrows, error } = await supabase
      .from('escrow_transactions')
      .select(`
        *,
        buyer:buyer_id (id, email, full_name),
        product:product_id (id, title)
      `)
      .in('status', ['shipped', 'escrow_held'])
      .lt('paid_at', threeDaysAgo.toISOString())
      .gt('paid_at', twoDaysAgo.toISOString());

    if (error || !escrows?.length) {
      console.log('[ESCROW CRON] No reminders to send');
      return { success: true, sent: 0 };
    }

    // TODO: Integrate with your notification service
    for (const escrow of escrows) {
      console.log(`[ESCROW CRON] Should send reminder to ${escrow.buyer?.email} for escrow ${escrow.id}`);
      // await notificationService.sendDeliveryReminder(escrow);
    }

    console.log(`[ESCROW CRON] Processed ${escrows.length} reminders`);
    return { success: true, sent: escrows.length };
  } catch (error) {
    console.error('[ESCROW CRON] Reminder error:', error);
    return { success: false, error: 'Reminder check failed' };
  }
};

/**
 * Retry failed payouts
 * Call this from your cron route (every 2 hours recommended)
 */
export const retryFailedPayouts = async () => {
  console.log('[ESCROW CRON] Retrying failed payouts...');
  
  try {
    const { data: failedPayouts, error } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('status', 'payout_failed')
      .limit(10);

    if (error || !failedPayouts?.length) {
      console.log('[ESCROW CRON] No failed payouts to retry');
      return { success: true, retried: 0 };
    }

    let retried = 0;

    for (const escrow of failedPayouts) {
      const result = await escrowService.releaseFundsToSeller(escrow.id);
      if (result.success) {
        retried++;
        console.log(`[ESCROW CRON] Retried payout for escrow ${escrow.id}`);
      }
    }

    console.log(`[ESCROW CRON] Retried ${retried}/${failedPayouts.length} payouts`);
    return { success: true, retried };
  } catch (error) {
    console.error('[ESCROW CRON] Payout retry error:', error);
    return { success: false, error: 'Payout retry failed' };
  }
};