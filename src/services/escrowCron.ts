// src/services/escrowCron.ts  (updated for Fincra)
//
// Change from Paystack version:
//   retryFailedPayouts: removed check for paystack_recipient_code.
//   Fincra sends to bank account details directly, so all we need is
//   account_number + bank_code in seller_bank_accounts.
// ================================================

import { escrowService } from "./escrowService";
import { createClient } from "@supabase/supabase-js";
import { notificationService } from "./notification.service";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── 1. AUTO-RELEASE ESCROWS (every 1 hour) ─────────────────────────────────
export const processAutoReleases = async () => {
  console.log("[CRON] Processing auto-releases...");
  try {
    const result = await escrowService.processAutoReleases();
    console.log(`[CRON] Auto-released ${result.processed} escrows`);
    return { success: true, processed: result.processed };
  } catch (error) {
    console.error("[CRON] Auto-release error:", error);
    return { success: false, error: "Auto-release failed" };
  }
};

// ── 2. RECONCILE MISSING ESCROW RECORDS (every 2 hours) ────────────────────
export const reconcileMissingEscrows = async () => {
  console.log("[CRON] Reconciling missing escrow records...");
  try {
    const result = await escrowService.reconcileMissingEscrows();
    console.log(`[CRON] Reconciled ${result.reconciled} orders`);
    return { success: true, reconciled: result.reconciled };
  } catch (error) {
    console.error("[CRON] Reconciliation error:", error);
    return { success: false, error: "Reconciliation failed" };
  }
};

// ── 3. DELIVERY REMINDERS (every 6 hours) ──────────────────────────────────
export const sendDeliveryReminders = async () => {
  console.log("[CRON] Checking for delivery reminders...");
  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: escrows, error } = await supabase
      .from("escrow_transactions")
      .select(`*, buyer:buyer_id (id, email, full_name), seller:seller_id (id, full_name)`)
      .in("status", ["shipped", "escrow_held"])
      .lt("paid_at", threeDaysAgo.toISOString())
      .not("paid_at", "is", null);

    if (error || !escrows?.length) {
      console.log("[CRON] No reminders to send");
      return { success: true, sent: 0 };
    }

    let sent = 0;

    for (const escrow of escrows) {
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", escrow.status === "shipped" ? escrow.buyer_id : escrow.seller_id)
          .like("metadata->>escrow_id", escrow.id)
          .gte("created_at", `${today}T00:00:00Z`)
          .maybeSingle();

        if (existing) continue;

        const { data: order } = await supabase
          .from("orders")
          .select("order_number")
          .eq("order_id", escrow.order_id)
          .single();

        const orderNum = order?.order_number || escrow.order_id;

        if (escrow.status === "shipped") {
          await notificationService.createNotification({
            user_id:    escrow.buyer_id,
            title:      "Confirm Your Delivery",
            message:    `Have you received order ${orderNum}? Please confirm so the seller can be paid.`,
            category:   "orders",
            type:       "info",
            action_url: `/orders/${escrow.order_id}`,
            metadata:   { escrow_id: escrow.id, reminder_type: "delivery_reminder" },
          });
        } else {
          await notificationService.createNotification({
            user_id:    escrow.seller_id,
            title:      "Ship Your Order",
            message:    `Order ${orderNum} is waiting to be shipped. Please ship soon.`,
            category:   "orders",
            type:       "warning",
            action_url: `/seller/orders/${escrow.order_id}`,
            metadata:   { escrow_id: escrow.id, reminder_type: "shipping_reminder" },
          });
        }

        sent++;
      } catch (err) {
        console.error(`[CRON] Reminder failed for escrow ${escrow.id}:`, err);
      }
    }

    console.log(`[CRON] Sent ${sent} reminders`);
    return { success: true, sent };
  } catch (error) {
    console.error("[CRON] Reminder error:", error);
    return { success: false, error: "Reminder check failed" };
  }
};

// ── 4. RETRY FAILED PAYOUTS (every 2 hours) ────────────────────────────────
// CHANGED: no longer checks paystack_recipient_code.
//          Fincra only needs account_number + bank_code, which are always
//          present once a bank account row exists.
export const retryFailedPayouts = async () => {
  console.log("[CRON] Retrying failed payouts...");
  try {
    const { data: failed, error } = await supabase
      .from("escrow_transactions")
      .select("*")
      .in("status", ["payout_failed", "pending_payout"])
      .limit(10);

    if (error || !failed?.length) {
      console.log("[CRON] No failed payouts to retry");
      return { success: true, retried: 0 };
    }

    let retried = 0;

    for (const escrow of failed) {
      if (escrow.status === "pending_payout") {
        // For Fincra, just check that the seller has a bank account with required fields
        const { data: bank } = await supabase
          .from("seller_bank_accounts")
          .select("account_number, bank_code")
          .eq("user_id", escrow.seller_id)
          .eq("is_primary", true)
          .single();

        // Skip if bank account is missing or incomplete
        if (!bank?.account_number || !bank?.bank_code) continue;
      }

      const result = await escrowService.releaseFundsToSeller(escrow.id);
      if (result.success) {
        retried++;
        console.log(`[CRON] Retried payout for escrow ${escrow.id}`);
      }
    }

    console.log(`[CRON] Retried ${retried}/${failed.length} payouts`);
    return { success: true, retried };
  } catch (error) {
    console.error("[CRON] Payout retry error:", error);
    return { success: false, error: "Payout retry failed" };
  }
};

// ── 5. SYNC STATUS CHECK (every 4 hours) ───────────────────────────────────
// Unchanged — no payment-provider logic here.
export const syncStatusCheck = async () => {
  console.log("[CRON] Running status sync check...");
  try {
    let fixed = 0;

    // Case 1: Escrow released but order not completed
    const { data: releasedEscrows } = await supabase
      .from("escrow_transactions")
      .select("id, order_id")
      .eq("status", "released");

    for (const escrow of releasedEscrows || []) {
      const { data: order } = await supabase
        .from("orders")
        .select("status, payment_status")
        .eq("order_id", escrow.order_id)
        .single();

      if (order && (order.status !== "completed" || order.payment_status !== "released")) {
        await supabase
          .from("orders")
          .update({ status: "completed", payment_status: "released", escrow_amount: 0, updated_at: new Date().toISOString() })
          .eq("order_id", escrow.order_id);
        fixed++;
      }
    }

    // Case 2: Order disputed but escrow not
    const { data: disputedOrders } = await supabase.from("orders").select("order_id").eq("status", "disputed");
    for (const order of disputedOrders || []) {
      const { data: escrow } = await supabase
        .from("escrow_transactions").select("id, status").eq("order_id", order.order_id).maybeSingle();
      if (escrow && escrow.status !== "disputed") {
        await supabase.from("escrow_transactions")
          .update({ status: "disputed", auto_release_at: null }).eq("id", escrow.id);
        fixed++;
      }
    }

    // Case 3: Order cancelled but escrow still held
    const { data: cancelledOrders } = await supabase.from("orders").select("order_id").eq("status", "cancelled");
    for (const order of cancelledOrders || []) {
      const { data: escrow } = await supabase
        .from("escrow_transactions").select("id, status").eq("order_id", order.order_id).maybeSingle();
      if (escrow && !["cancelled", "refunded", "released"].includes(escrow.status)) {
        await supabase.from("escrow_transactions")
          .update({ status: "cancelled", auto_release_at: null }).eq("id", escrow.id);
        fixed++;
      }
    }

    // Case 4: Order shipped but escrow not
    const { data: shippedOrders } = await supabase.from("orders").select("order_id").eq("status", "shipped");
    for (const order of shippedOrders || []) {
      const { data: escrow } = await supabase
        .from("escrow_transactions").select("id, status").eq("order_id", order.order_id).maybeSingle();
      if (escrow && escrow.status === "escrow_held") {
        await supabase.from("escrow_transactions")
          .update({ status: "shipped", shipped_at: new Date().toISOString() }).eq("id", escrow.id);
        fixed++;
      }
    }

    console.log(`[CRON] Sync check complete. Fixed ${fixed} records.`);
    return { success: true, fixed };
  } catch (error) {
    console.error("[CRON] Sync check error:", error);
    return { success: false, error: "Sync check failed" };
  }
};