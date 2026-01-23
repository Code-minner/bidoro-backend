// src/services/escrowService.ts

import { createClient } from '@supabase/supabase-js';
import { paystackService } from './paystackService';
import { paystackConfig } from '../config/paystack';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper: Generate unique reference
const generateReference = (prefix = 'BIDORO') => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

// Helper: Calculate fees
export const calculateFees = (amount: number) => {
  const platformFeePercent = paystackConfig.platformFeePercent;
  const platformFee = (amount * platformFeePercent) / 100;
  const sellerAmount = amount - platformFee;
  
  return {
    totalAmount: amount,
    platformFee: Math.round(platformFee * 100) / 100,
    sellerAmount: Math.round(sellerAmount * 100) / 100,
  };
};

interface CreateEscrowParams {
  buyerId: string;
  sellerId: string;
  productId: string;
  orderId: string;
  amount: number;
  buyerEmail: string;
}

export const escrowService = {
  /**
   * Create escrow transaction and initialize payment
   */
  async createEscrowPayment({ buyerId, sellerId, productId, orderId, amount, buyerEmail }: CreateEscrowParams) {
    const reference = generateReference('ESC');
    const fees = calculateFees(amount);
    
    // Calculate auto-release date (5 days from now)
    const autoReleaseAt = new Date();
    autoReleaseAt.setDate(autoReleaseAt.getDate() + paystackConfig.autoReleaseDays);

    // 1. Create escrow record
    const { data: escrow, error: dbError } = await supabase
      .from('escrow_transactions')
      .insert({
        order_id: orderId,
        buyer_id: buyerId,
        seller_id: sellerId,
        product_id: productId,
        amount: fees.totalAmount,
        platform_fee: fees.platformFee,
        seller_amount: fees.sellerAmount,
        paystack_reference: reference,
        status: 'pending',
        auto_release_at: autoReleaseAt.toISOString(),
      })
      .select()
      .single();

    if (dbError) {
      console.error('Escrow DB error:', dbError);
      return { success: false, error: 'Failed to create escrow record' };
    }

    // 2. Initialize Paystack payment
    const paymentResult = await paystackService.initializeTransaction({
      email: buyerEmail,
      amount: fees.totalAmount,
      reference,
      callbackUrl: `${process.env.FRONTEND_URL}/payment/verify`,
      metadata: {
        escrow_id: escrow.id,
        order_id: orderId,
        buyer_id: buyerId,
        seller_id: sellerId,
        product_id: productId,
        type: 'escrow_payment',
      },
    });

    if (!paymentResult.success) {
      // Rollback
      await supabase.from('escrow_transactions').delete().eq('id', escrow.id);
      return { success: false, error: paymentResult.error };
    }

    return {
      success: true,
      data: {
        escrowId: escrow.id,
        reference,
        authorizationUrl: paymentResult.data.authorization_url,
        accessCode: paymentResult.data.access_code,
        fees,
      },
    };
  },

  /**
   * Handle successful payment (called from webhook)
   */
  async handlePaymentSuccess(reference: string, paystackData: any) {
    const { data: escrow, error } = await supabase
      .from('escrow_transactions')
      .update({
        status: 'escrow_held',
        paid_at: new Date().toISOString(),
      })
      .eq('paystack_reference', reference)
      .select()
      .single();

    if (error) {
      console.error('Update escrow error:', error);
      return { success: false, error: 'Failed to update escrow' };
    }

    // Update order status
    await supabase
      .from('orders')
      .update({ 
        status: 'paid',
        payment_status: 'completed',
      })
      .eq('id', escrow.order_id);

    return { success: true, data: escrow };
  },

  /**
   * Mark order as shipped (seller action)
   */
  async markAsShipped(escrowId: string, sellerId: string, trackingInfo?: { trackingNumber: string; deliveryCompany: string }) {
    // Verify seller owns this escrow
    const { data: escrow, error: fetchError } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('id', escrowId)
      .eq('seller_id', sellerId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: 'Escrow not found or unauthorized' };
    }

    if (escrow.status !== 'escrow_held') {
      return { success: false, error: `Cannot ship order with status: ${escrow.status}` };
    }

    const { data: updated, error } = await supabase
      .from('escrow_transactions')
      .update({
        status: 'shipped',
        shipped_at: new Date().toISOString(),
      })
      .eq('id', escrowId)
      .select()
      .single();

    if (error) {
      return { success: false, error: 'Failed to update status' };
    }

    // Update order with tracking info
    if (trackingInfo) {
      await supabase
        .from('orders')
        .update({ 
          tracking_info: trackingInfo,
          status: 'shipped',
        })
        .eq('id', escrow.order_id);
    }

    return { success: true, data: updated };
  },

  /**
   * Confirm delivery (buyer action) - triggers payout
   */
  async confirmDelivery(escrowId: string, buyerId: string) {
    const { data: escrow, error: fetchError } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('id', escrowId)
      .eq('buyer_id', buyerId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: 'Escrow not found or unauthorized' };
    }

    if (escrow.status !== 'shipped' && escrow.status !== 'escrow_held') {
      return { success: false, error: `Cannot confirm delivery with status: ${escrow.status}` };
    }

    // Update status to delivered
    await supabase
      .from('escrow_transactions')
      .update({
        status: 'delivered',
        delivered_at: new Date().toISOString(),
      })
      .eq('id', escrowId);

    // Trigger payout
    const payoutResult = await this.releaseFundsToSeller(escrowId);
    return payoutResult;
  },

  /**
   * Release funds to seller
   */
  async releaseFundsToSeller(escrowId: string) {
    // Get escrow with seller bank details
    const { data: escrow, error: fetchError } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('id', escrowId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: 'Escrow not found' };
    }

    // Get seller's bank account
    const { data: bankAccount } = await supabase
      .from('seller_bank_accounts')
      .select('*')
      .eq('user_id', escrow.seller_id)
      .eq('is_primary', true)
      .single();

    if (!bankAccount?.paystack_recipient_code) {
      await supabase
        .from('escrow_transactions')
        .update({ status: 'pending_payout' })
        .eq('id', escrowId);

      return { 
        success: false, 
        error: 'Seller has no payout account set up. Pending manual processing.' 
      };
    }

    const payoutReference = generateReference('PAY');

    // Initiate transfer
    const transferResult = await paystackService.initiateTransfer({
      amount: escrow.seller_amount,
      recipientCode: bankAccount.paystack_recipient_code,
      reference: payoutReference,
      reason: `Bidoro Order Payout - ${escrow.order_id}`,
    });

    if (!transferResult.success) {
      await supabase
        .from('escrow_transactions')
        .update({ status: 'payout_failed' })
        .eq('id', escrowId);

      return { success: false, error: transferResult.error };
    }

    // Update escrow
    const { data: updated } = await supabase
      .from('escrow_transactions')
      .update({
        status: 'released',
        paystack_transfer_code: transferResult.data.transfer_code,
        released_at: new Date().toISOString(),
      })
      .eq('id', escrowId)
      .select()
      .single();

    // Update order
    await supabase
      .from('orders')
      .update({ status: 'completed' })
      .eq('id', escrow.order_id);

    return { success: true, data: updated };
  },

  /**
   * Open dispute (buyer action)
   */
  async openDispute(escrowId: string, buyerId: string, reason: string) {
    const { data: escrow, error: fetchError } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('id', escrowId)
      .eq('buyer_id', buyerId)
      .single();

    if (fetchError || !escrow) {
      return { success: false, error: 'Escrow not found or unauthorized' };
    }

    if (!['shipped', 'escrow_held'].includes(escrow.status)) {
      return { success: false, error: `Cannot dispute order with status: ${escrow.status}` };
    }

    const { data: updated, error } = await supabase
      .from('escrow_transactions')
      .update({
        status: 'disputed',
        dispute_reason: reason,
        dispute_opened_at: new Date().toISOString(),
        auto_release_at: null, // Cancel auto-release
      })
      .eq('id', escrowId)
      .select()
      .single();

    if (error) {
      return { success: false, error: 'Failed to open dispute' };
    }

    return { success: true, data: updated };
  },

  /**
   * Process auto-releases (called by cron)
   */
  async processAutoReleases() {
    const now = new Date().toISOString();

    const { data: escrows, error } = await supabase
      .from('escrow_transactions')
      .select('*')
      .in('status', ['shipped', 'escrow_held'])
      .lt('auto_release_at', now);

    if (error || !escrows?.length) {
      return { processed: 0 };
    }

    let processed = 0;

    for (const escrow of escrows) {
      const result = await this.releaseFundsToSeller(escrow.id);
      if (result.success) {
        processed++;
        console.log(`Auto-released escrow ${escrow.id}`);
      }
    }

    return { processed };
  },

  /**
   * Get escrow by ID
   */
  async getEscrowById(escrowId: string, userId: string) {
    const { data, error } = await supabase
      .from('escrow_transactions')
      .select(`
        *,
        buyer:buyer_id (id, full_name, email),
        seller:seller_id (id, full_name, email),
        product:product_id (id, title, images)
      `)
      .eq('id', escrowId)
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .single();

    if (error) {
      return { success: false, error: 'Escrow not found' };
    }

    return { success: true, data };
  },

  /**
   * Get user's escrows
   */
  async getUserEscrows(userId: string, role: 'buyer' | 'seller' | 'both' = 'both', status?: string) {
    let query = supabase
      .from('escrow_transactions')
      .select(`
        *,
        buyer:buyer_id (id, full_name),
        seller:seller_id (id, full_name),
        product:product_id (id, title, images, price)
      `)
      .order('created_at', { ascending: false });

    if (role === 'buyer') {
      query = query.eq('buyer_id', userId);
    } else if (role === 'seller') {
      query = query.eq('seller_id', userId);
    } else {
      query = query.or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      return { success: false, error: 'Failed to fetch escrows' };
    }

    return { success: true, data };
  },
};

export default escrowService;