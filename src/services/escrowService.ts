// ================================================
// BIDORO - UNIFIED ESCROW SERVICE (SYNCED)
// File: src/services/escrowService.ts
//
// FEE MODEL:
//   Buyer pays:  subtotal + delivery (no extra fee)
//   On payout:   Platform keeps 8.2% of order total
//                Seller gets 91.8%
//
// The 8.2% comes from src/config/pricing.ts — one
// place to change it.
//
// This is the SINGLE source of truth for all escrow
// operations. orders.ts and checkout.ts delegate here.
// ================================================

import { createClient } from "@supabase/supabase-js";
import { paystackService } from "./paystackService";
import {
  calculateEscrowSplit,
  PLATFORM_FEE_PERCENT,
  AUTO_RELEASE_DAYS,
} from "../config/pricing";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ================================================
// HELPERS
// ================================================

const generateReference = (prefix = "BIDORO") => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

const toKobo = (naira: number): number => Math.round(naira * 100);

// ================================================
// TYPES
// ================================================

interface CreateEscrowParams {
  buyerId: string;
  sellerId: string;
  productId?: string;
  orderId: string;
  amount: number;       // Full order total (what buyer paid)
  buyerEmail: string;
}

/**
 * Escrow Statuses (match DB constraint):
 *   pending        -> payment initialized
 *   escrow_held    -> payment confirmed, funds held
 *   shipped        -> seller shipped item
 *   delivered      -> buyer confirmed delivery
 *   released       -> funds transferred to seller
 *   disputed       -> buyer opened dispute
 *   cancelled      -> order cancelled
 *   payout_failed  -> transfer to seller failed
 *   pending_payout -> seller has no bank account
 *   refunded       -> refund processed
 */

// ================================================
// MAIN SERVICE
// ================================================

export const escrowService = {
  // ================================================
  // CREATE ESCROW RECORD
  // The 8.2% split is calculated here using pricing.ts.
  // ================================================
  async createEscrowForOrder({
    buyerId,
    sellerId,
    productId,
    orderId,
    amount,
    buyerEmail,
  }: CreateEscrowParams) {
    const reference = generateReference("ESC");

    // Calculate the split using the single source of truth
    const split = calculateEscrowSplit(amount);

    const autoReleaseAt = new Date();
    autoReleaseAt.setDate(autoReleaseAt.getDate() + AUTO_RELEASE_DAYS);

    const { data: escrow, error: dbError } = await supabase
      .from("escrow_transactions")
      .insert({
        order_id: orderId,
        buyer_id: buyerId,
        seller_id: sellerId,
        product_id: productId || null,
        amount: split.totalAmount,
        platform_fee: split.platformFee,
        seller_amount: split.sellerAmount,
        fee_percent: split.feePercent,
        paystack_reference: reference,
        status: "pending",
        auto_release_at: autoReleaseAt.toISOString(),
      })
      .select()
      .single();

    if (dbError) {
      console.error("Escrow DB error:", dbError);
      return { success: false, error: "Failed to create escrow record" };
    }

    return {
      success: true,
      data: {
        escrowId: escrow.id,
        reference,
        split,
        autoReleaseAt: autoReleaseAt.toISOString(),
      },
    };
  },

  // ================================================
  // INITIALIZE PAYMENT (standalone flow)
  // Creates escrow + initializes Paystack
  // ================================================
  async createEscrowPayment({
    buyerId,
    sellerId,
    productId,
    orderId,
    amount,
    buyerEmail,
  }: CreateEscrowParams) {
    const escrowResult = await this.createEscrowForOrder({
      buyerId,
      sellerId,
      productId,
      orderId,
      amount,
      buyerEmail,
    });

    if (!escrowResult.success) return escrowResult;

    const { escrowId, reference, split } = escrowResult.data!;

    const paymentResult = await paystackService.initializeTransaction({
      email: buyerEmail,
      amount: split.totalAmount,
      reference,
      callbackUrl: `${process.env.FRONTEND_URL}/payment/verify`,
      metadata: {
        escrow_id: escrowId,
        order_id: orderId,
        buyer_id: buyerId,
        seller_id: sellerId,
        product_id: productId,
        type: "escrow_payment",
      },
    });

    if (!paymentResult.success) {
      await supabase.from("escrow_transactions").delete().eq("id", escrowId);
      return { success: false, error: paymentResult.error };
    }

    return {
      success: true,
      data: {
        escrowId,
        reference,
        authorizationUrl: paymentResult.data.authorization_url,
        accessCode: paymentResult.data.access_code,
        split,
      },
    };
  },

  // ================================================
  // HANDLE PAYMENT SUCCESS
  // Updates BOTH escrow_transactions AND orders
  // ================================================
  async handlePaymentSuccess(reference: string, paystackData: any) {
    const { data: escrow, error } = await supabase
      .from("escrow_transactions")
      .update({
        status: "escrow_held",
        paid_at: new Date().toISOString(),
      })
      .eq("paystack_reference", reference)
      .select()
      .single();

    if (error) {
      console.error("Update escrow error:", error);
      return { success: false, error: "Failed to update escrow" };
    }

    // SYNC: Update the linked order
    const { error: orderError } = await supabase
      .from("orders")
      .update({
        status: "confirmed",
        payment_status: "paid",
        payment_reference: reference,
        escrow_amount: escrow.amount,
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", escrow.order_id);

    if (orderError) {
      console.error("Update order error:", orderError);
    }

    return { success: true, data: escrow };
  },

  // ================================================
  // MARK AS SHIPPED
  // ================================================
  async markAsShipped(
    escrowId: string,
    sellerId: string,
    trackingInfo?: { trackingNumber: string; deliveryCompany: string }
  ) {
    const { data: escrow, error: fetchError } = await supabase
      .from("escrow_transactions")
      .select("*")
      .eq("id", escrowId)
      .eq("seller_id", sellerId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: "Escrow not found or unauthorized" };
    }

    if (escrow.status !== "escrow_held") {
      return { success: false, error: `Cannot ship order with status: ${escrow.status}` };
    }

    const { data: updated, error } = await supabase
      .from("escrow_transactions")
      .update({ status: "shipped", shipped_at: new Date().toISOString() })
      .eq("id", escrowId)
      .select()
      .single();

    if (error) return { success: false, error: "Failed to update status" };

    // SYNC: Update order
    const orderUpdate: any = { status: "shipped", updated_at: new Date().toISOString() };
    if (trackingInfo) orderUpdate.tracking_number = trackingInfo.trackingNumber;

    await supabase.from("orders").update(orderUpdate).eq("order_id", escrow.order_id);

    return { success: true, data: updated };
  },

  // ================================================
  // CONFIRM DELIVERY -> triggers payout
  // ================================================
  async confirmDelivery(escrowId: string, buyerId: string) {
    const { data: escrow, error: fetchError } = await supabase
      .from("escrow_transactions")
      .select("*")
      .eq("id", escrowId)
      .eq("buyer_id", buyerId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: "Escrow not found or unauthorized" };
    }

    if (!["shipped", "escrow_held"].includes(escrow.status)) {
      return { success: false, error: `Cannot confirm delivery with status: ${escrow.status}` };
    }

    await supabase
      .from("escrow_transactions")
      .update({ status: "delivered", delivered_at: new Date().toISOString() })
      .eq("id", escrowId);

    await supabase
      .from("orders")
      .update({
        status: "delivered",
        delivered_at: new Date().toISOString(),
        actual_delivery: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", escrow.order_id);

    // Trigger payout
    return await this.releaseFundsToSeller(escrowId);
  },

  // ================================================
  // RELEASE FUNDS TO SELLER
  //
  // This is the CRITICAL payout point:
  //   1. Seller gets 91.8% (order total minus 8.2%)
  //   2. Initiates Paystack transfer for seller_amount
  //   3. Updates escrow_transactions
  //   4. Updates orders
  //   5. Credits seller_wallets
  //   6. Creates wallet_transaction record
  // ================================================
  async releaseFundsToSeller(escrowId: string) {
    const { data: escrow, error: fetchError } = await supabase
      .from("escrow_transactions")
      .select("*")
      .eq("id", escrowId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: "Escrow not found" };
    }

    // Get seller's bank account
    const { data: bankAccount } = await supabase
      .from("seller_bank_accounts")
      .select("*")
      .eq("user_id", escrow.seller_id)
      .eq("is_primary", true)
      .single();

    if (!bankAccount?.paystack_recipient_code) {
      await supabase
        .from("escrow_transactions")
        .update({ status: "pending_payout" })
        .eq("id", escrowId);

      return {
        success: false,
        error: "Seller has no payout account. Pending manual processing.",
      };
    }

    const payoutReference = generateReference("PAY");

    // ---- STEP 1: Paystack transfer (seller_amount = 91.8% of total) ----
    const transferResult = await paystackService.initiateTransfer({
      amount: escrow.seller_amount,
      recipientCode: bankAccount.paystack_recipient_code,
      reference: payoutReference,
      reason: `Bidoro Order Payout - ${escrow.order_id}`,
    });

    if (!transferResult.success) {
      await supabase
        .from("escrow_transactions")
        .update({ status: "payout_failed" })
        .eq("id", escrowId);

      return { success: false, error: transferResult.error };
    }

    // ---- STEP 2: Update escrow ----
    const { data: updated } = await supabase
      .from("escrow_transactions")
      .update({
        status: "released",
        paystack_transfer_code: transferResult.data.transfer_code,
        released_at: new Date().toISOString(),
      })
      .eq("id", escrowId)
      .select()
      .single();

    // ---- STEP 3: Update order ----
    await supabase
      .from("orders")
      .update({
        status: "completed",
        payment_status: "released",
        escrow_amount: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("order_id", escrow.order_id);

    // ---- STEP 4: Credit seller wallet ----
    await this.creditSellerWallet(
      escrow.seller_id,
      escrow.seller_amount,
      escrow.order_id,
      escrowId,
      payoutReference
    );

    return { success: true, data: updated };
  },

  // ================================================
  // CREDIT SELLER WALLET
  // ================================================
  async creditSellerWallet(
    sellerId: string,
    amount: number,
    orderId: string,
    escrowId: string,
    reference: string
  ) {
    try {
      const amountInKobo = toKobo(amount);

      let { data: wallet, error: walletError } = await supabase
        .from("seller_wallets")
        .select("*")
        .eq("user_id", sellerId)
        .single();

      if (walletError && walletError.code === "PGRST116") {
        const { data: newWallet, error: createError } = await supabase
          .from("seller_wallets")
          .insert({ user_id: sellerId })
          .select()
          .single();

        if (createError) {
          console.error("Failed to create wallet:", sellerId, createError);
          return;
        }
        wallet = newWallet;
      } else if (walletError) {
        console.error("Wallet lookup error:", walletError);
        return;
      }

      const newAvailableBalance = (wallet.available_balance || 0) + amountInKobo;
      const newTotalEarned = (wallet.total_earned || 0) + amountInKobo;
      const newEscrowBalance = Math.max(0, (wallet.escrow_balance || 0) - amountInKobo);

      await supabase
        .from("seller_wallets")
        .update({
          available_balance: newAvailableBalance,
          total_earned: newTotalEarned,
          escrow_balance: newEscrowBalance,
          updated_at: new Date().toISOString(),
        })
        .eq("wallet_id", wallet.wallet_id);

      await supabase.from("wallet_transactions").insert({
        wallet_id: wallet.wallet_id,
        user_id: sellerId,
        type: "escrow_release",
        amount: amountInKobo,
        direction: "credit",
        balance_after: newAvailableBalance,
        reference,
        order_id: orderId,
        escrow_id: escrowId,
        status: "completed",
        description: `Escrow released for order ${orderId}`,
      });

      console.log(`Wallet credited for seller ${sellerId}: NGN ${amount} (order: ${orderId})`);
    } catch (error) {
      console.error("Failed to credit seller wallet:", error);
    }
  },

  // ================================================
  // HOLD ESCROW IN WALLET (display purposes)
  // ================================================
  async holdEscrowInWallet(sellerId: string, amount: number) {
    try {
      const amountInKobo = toKobo(amount);

      let { data: wallet } = await supabase
        .from("seller_wallets")
        .select("*")
        .eq("user_id", sellerId)
        .single();

      if (!wallet) {
        const { data: newWallet } = await supabase
          .from("seller_wallets")
          .insert({ user_id: sellerId })
          .select()
          .single();
        wallet = newWallet;
      }

      if (wallet) {
        await supabase
          .from("seller_wallets")
          .update({
            escrow_balance: (wallet.escrow_balance || 0) + amountInKobo,
            updated_at: new Date().toISOString(),
          })
          .eq("wallet_id", wallet.wallet_id);
      }
    } catch (error) {
      console.error("Failed to update escrow balance in wallet:", error);
    }
  },

  // ================================================
  // OPEN DISPUTE
  // ================================================
  async openDispute(escrowId: string, buyerId: string, reason: string) {
    const { data: escrow, error: fetchError } = await supabase
      .from("escrow_transactions")
      .select("*")
      .eq("id", escrowId)
      .eq("buyer_id", buyerId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: "Escrow not found or unauthorized" };
    }

    if (!["shipped", "escrow_held"].includes(escrow.status)) {
      return { success: false, error: `Cannot dispute order with status: ${escrow.status}` };
    }

    const { data: updated, error } = await supabase
      .from("escrow_transactions")
      .update({
        status: "disputed",
        dispute_reason: reason,
        dispute_opened_at: new Date().toISOString(),
        auto_release_at: null,
      })
      .eq("id", escrowId)
      .select()
      .single();

    if (error) return { success: false, error: "Failed to open dispute" };

    await supabase
      .from("orders")
      .update({ status: "disputed", updated_at: new Date().toISOString() })
      .eq("order_id", escrow.order_id);

    return { success: true, data: updated };
  },

  // ================================================
  // RESOLVE DISPUTE (admin only)
  // ================================================
  async resolveDispute(
    escrowId: string,
    adminId: string,
    resolution: string,
    outcome: "release_to_seller" | "refund_buyer" | "partial_refund",
    partialAmount?: number
  ) {
    const { data: escrow, error: fetchError } = await supabase
      .from("escrow_transactions")
      .select("*")
      .eq("id", escrowId)
      .single();

    if (fetchError || !escrow) return { success: false, error: "Escrow not found" };
    if (escrow.status !== "disputed") return { success: false, error: "Not in disputed status" };

    let newEscrowStatus: string;
    let newOrderStatus: string;

    switch (outcome) {
      case "release_to_seller":
        const releaseResult = await this.releaseFundsToSeller(escrowId);
        if (!releaseResult.success) return releaseResult;
        newEscrowStatus = "released";
        newOrderStatus = "completed";
        break;

      case "refund_buyer":
        newEscrowStatus = "refunded";
        newOrderStatus = "cancelled";
        break;

      case "partial_refund":
        newEscrowStatus = "released";
        newOrderStatus = "completed";
        break;

      default:
        return { success: false, error: "Invalid outcome" };
    }

    await supabase
      .from("escrow_transactions")
      .update({
        status: newEscrowStatus,
        dispute_resolved_at: new Date().toISOString(),
        dispute_resolution: resolution,
        dispute_resolved_by: adminId,
      })
      .eq("id", escrowId);

    await supabase
      .from("orders")
      .update({ status: newOrderStatus, updated_at: new Date().toISOString() })
      .eq("order_id", escrow.order_id);

    return { success: true, data: { escrowId, outcome, resolution } };
  },

  // ================================================
  // CRON: AUTO-RELEASE
  // ================================================
  async processAutoReleases() {
    const now = new Date().toISOString();

    const { data: escrows, error } = await supabase
      .from("escrow_transactions")
      .select("*")
      .in("status", ["shipped", "escrow_held"])
      .not("auto_release_at", "is", null)
      .lt("auto_release_at", now);

    if (error || !escrows?.length) return { processed: 0 };

    let processed = 0;

    for (const escrow of escrows) {
      const result = await this.releaseFundsToSeller(escrow.id);
      if (result.success) {
        processed++;
        console.log(`Auto-released escrow ${escrow.id} for order ${escrow.order_id}`);
      } else {
        console.error(`Failed auto-release for escrow ${escrow.id}:`, result.error);
      }
    }

    return { processed };
  },

  // ================================================
  // CRON: RECONCILE ORDERS WITHOUT ESCROW RECORDS
  // ================================================
  async reconcileMissingEscrows() {
    const { data: orphanedOrders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("payment_status", "paid")
      .in("status", ["confirmed", "processing", "shipped"])
      .not("payment_reference", "is", null);

    if (error || !orphanedOrders?.length) return { reconciled: 0 };

    let reconciled = 0;

    for (const order of orphanedOrders) {
      const { data: existingEscrow } = await supabase
        .from("escrow_transactions")
        .select("id")
        .eq("order_id", order.order_id)
        .maybeSingle();

      if (!existingEscrow) {
        const split = calculateEscrowSplit(Number(order.total_amount));

        const autoReleaseAt = new Date();
        autoReleaseAt.setDate(autoReleaseAt.getDate() + AUTO_RELEASE_DAYS);

        await supabase.from("escrow_transactions").insert({
          order_id: order.order_id,
          buyer_id: order.buyer_id,
          seller_id: order.seller_id,
          amount: split.totalAmount,
          platform_fee: split.platformFee,
          seller_amount: split.sellerAmount,
          fee_percent: split.feePercent,
          paystack_reference: order.payment_reference,
          status: "escrow_held",
          paid_at: order.updated_at,
          auto_release_at: autoReleaseAt.toISOString(),
        });

        reconciled++;
        console.log(`Reconciled escrow for order ${order.order_id}`);
      }
    }

    return { reconciled };
  },

  // ================================================
  // GETTERS
  // ================================================
  async getEscrowById(escrowId: string, userId: string) {
    const { data, error } = await supabase
      .from("escrow_transactions")
      .select(`
        *,
        buyer:buyer_id (id, full_name, email),
        seller:seller_id (id, full_name, email),
        product:product_id (id, title, images)
      `)
      .eq("id", escrowId)
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .single();

    if (error) return { success: false, error: "Escrow not found" };
    return { success: true, data };
  },

  async getEscrowByOrderId(orderId: string) {
    const { data, error } = await supabase
      .from("escrow_transactions")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    if (error) return { success: false, error: "Failed to fetch escrow", data: null };
    return { success: true, data };
  },

  async getUserEscrows(
    userId: string,
    role: "buyer" | "seller" | "both" = "both",
    status?: string
  ) {
    let query = supabase
      .from("escrow_transactions")
      .select(`
        *,
        buyer:buyer_id (id, full_name),
        seller:seller_id (id, full_name),
        product:product_id (id, title, images, price)
      `)
      .order("created_at", { ascending: false });

    if (role === "buyer") query = query.eq("buyer_id", userId);
    else if (role === "seller") query = query.eq("seller_id", userId);
    else query = query.or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return { success: false, error: "Failed to fetch escrows" };
    return { success: true, data };
  },
};

// Re-export for escrow routes
export { calculateEscrowSplit as calculateFees };
export default escrowService;