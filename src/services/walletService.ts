// backend/services/walletService.ts
// ============================================
// BIDORO WALLET SERVICE
// Handles all seller wallet operations
// ============================================

import { supabaseAdmin as supabase } from '../config/database';
import paystackService from './paystackService';

// Minimum withdrawal amount in Naira
const MIN_WITHDRAWAL_AMOUNT = 100;
const MAX_WITHDRAWAL_AMOUNT = 5000000; // 5 million Naira

// Convert Naira to Kobo
const toKobo = (naira: number): number => Math.round(naira * 100);

// Convert Kobo to Naira
const toNaira = (kobo: number): number => kobo / 100;

// Generate unique reference
const generateReference = (prefix: string = 'WTH'): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`.toUpperCase();
};

interface WalletResult {
  success: boolean;
  data?: any;
  error?: string;
}

interface WithdrawalParams {
  userId: string;
  amount: number; // Amount in Naira
  bankAccountId?: number;
}

export const walletService = {
  /**
   * Get or create wallet for a user
   */
  async getOrCreateWallet(userId: string): Promise<WalletResult> {
    try {
      // Try to get existing wallet
      let { data: wallet, error } = await supabase
        .from('seller_wallets')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // Error other than "not found"
        console.error('Get wallet error:', error);
        return { success: false, error: 'Failed to get wallet' };
      }

      if (!wallet) {
        // Create new wallet
        const { data: newWallet, error: createError } = await supabase
          .from('seller_wallets')
          .insert({ user_id: userId })
          .select()
          .single();

        if (createError) {
          console.error('Create wallet error:', createError);
          return { success: false, error: 'Failed to create wallet' };
        }

        wallet = newWallet;
      }

      return {
        success: true,
        data: {
          wallet_id: wallet.wallet_id,
          user_id: wallet.user_id,
          available_balance: toNaira(wallet.available_balance),
          escrow_balance: toNaira(wallet.escrow_balance),
          total_withdrawn: toNaira(wallet.total_withdrawn),
          total_earned: toNaira(wallet.total_earned),
          is_active: wallet.is_active,
          created_at: wallet.created_at,
          updated_at: wallet.updated_at,
        },
      };
    } catch (error: any) {
      console.error('Get or create wallet error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get wallet balance summary
   */
  async getWalletSummary(userId: string): Promise<WalletResult> {
    try {
      const walletResult = await this.getOrCreateWallet(userId);
      if (!walletResult.success) {
        return walletResult;
      }

      // Get pending withdrawals count
      const { count: pendingWithdrawals } = await supabase
        .from('withdrawals')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending');

      // Get recent transactions
      const { data: recentTransactions } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);

      return {
        success: true,
        data: {
          ...walletResult.data,
          pending_withdrawals: pendingWithdrawals || 0,
          recent_transactions: recentTransactions?.map(tx => ({
            ...tx,
            amount: toNaira(tx.amount),
            balance_after: toNaira(tx.balance_after),
          })) || [],
        },
      };
    } catch (error: any) {
      console.error('Get wallet summary error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get wallet transactions with pagination
   */
  async getTransactions(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      type?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
    } = {}
  ): Promise<WalletResult> {
    try {
      const { page = 1, limit = 20, type, status, startDate, endDate } = options;
      const offset = (page - 1) * limit;

      let query = supabase
        .from('wallet_transactions')
        .select('*, orders(order_id, status)', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (type) {
        query = query.eq('type', type);
      }

      if (status) {
        query = query.eq('status', status);
      }

      if (startDate) {
        query = query.gte('created_at', startDate);
      }

      if (endDate) {
        query = query.lte('created_at', endDate);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('Get transactions error:', error);
        return { success: false, error: 'Failed to get transactions' };
      }

      return {
        success: true,
        data: {
          transactions: data?.map(tx => ({
            id: tx.transaction_id,
            type: tx.type,
            amount: toNaira(tx.amount),
            direction: tx.direction,
            balance_after: toNaira(tx.balance_after),
            reference: tx.reference,
            status: tx.status,
            description: tx.description,
            created_at: tx.created_at,
            order: tx.orders,
          })) || [],
          pagination: {
            page,
            limit,
            total: count || 0,
            totalPages: Math.ceil((count || 0) / limit),
          },
        },
      };
    } catch (error: any) {
      console.error('Get transactions error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Initiate withdrawal
   */
  async initiateWithdrawal({ userId, amount, bankAccountId }: WithdrawalParams): Promise<WalletResult> {
    try {
      // Validate amount
      if (amount < MIN_WITHDRAWAL_AMOUNT) {
        return { success: false, error: `Minimum withdrawal amount is ₦${MIN_WITHDRAWAL_AMOUNT}` };
      }

      if (amount > MAX_WITHDRAWAL_AMOUNT) {
        return { success: false, error: `Maximum withdrawal amount is ₦${MAX_WITHDRAWAL_AMOUNT.toLocaleString()}` };
      }

      const amountInKobo = toKobo(amount);

      // Get wallet
      const { data: wallet, error: walletError } = await supabase
        .from('seller_wallets')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (walletError || !wallet) {
        return { success: false, error: 'Wallet not found' };
      }

      if (!wallet.is_active) {
        return { success: false, error: 'Wallet is not active' };
      }

      if (wallet.available_balance < amountInKobo) {
        return { success: false, error: 'Insufficient balance' };
      }

      // Get bank account
      let bankQuery = supabase
        .from('seller_bank_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (bankAccountId) {
        bankQuery = bankQuery.eq('idx', bankAccountId);
      } else {
        bankQuery = bankQuery.eq('is_primary', true);
      }

      const { data: bankAccount, error: bankError } = await bankQuery.single();

      if (bankError || !bankAccount) {
        return { success: false, error: 'No active bank account found. Please add a withdrawal account.' };
      }

      // Check if recipient code exists, create if not
      let recipientCode = bankAccount.paystack_recipient_code;

      if (!recipientCode) {
        const recipientResult = await paystackService.createTransferRecipient({
          name: bankAccount.account_name,
          accountNumber: bankAccount.account_number,
          bankCode: bankAccount.bank_code,
        });

        if (!recipientResult.success) {
          return { success: false, error: recipientResult.error || 'Failed to create transfer recipient' };
        }

        recipientCode = recipientResult.data.recipient_code;

        // Update bank account with recipient code
        await supabase
          .from('seller_bank_accounts')
          .update({ paystack_recipient_code: recipientCode })
          .eq('idx', bankAccount.idx);
      }

      const withdrawalReference = generateReference('WTH');

      // Create withdrawal record
      const { data: withdrawal, error: withdrawalError } = await supabase
        .from('withdrawals')
        .insert({
          wallet_id: wallet.wallet_id,
          user_id: userId,
          bank_account_id: bankAccount.idx,
          account_number: bankAccount.account_number,
          bank_code: bankAccount.bank_code,
          bank_name: bankAccount.bank_name,
          account_name: bankAccount.account_name,
          recipient_code: recipientCode,
          amount: amountInKobo,
          reference: withdrawalReference,
          status: 'pending',
        })
        .select()
        .single();

      if (withdrawalError) {
        console.error('Create withdrawal error:', withdrawalError);
        return { success: false, error: 'Failed to create withdrawal request' };
      }

      // Deduct from available balance (hold)
      const newAvailableBalance = wallet.available_balance - amountInKobo;

      await supabase
        .from('seller_wallets')
        .update({ 
          available_balance: newAvailableBalance,
          updated_at: new Date().toISOString()
        })
        .eq('wallet_id', wallet.wallet_id);

      // Record wallet transaction
      await supabase.from('wallet_transactions').insert({
        wallet_id: wallet.wallet_id,
        user_id: userId,
        type: 'withdrawal',
        amount: amountInKobo,
        direction: 'debit',
        balance_after: newAvailableBalance,
        reference: withdrawalReference,
        withdrawal_id: withdrawal.withdrawal_id,
        status: 'pending',
        description: `Withdrawal to ${bankAccount.bank_name} - ${bankAccount.account_number}`,
      });

      // Initiate Paystack transfer
      const transferResult = await paystackService.initiateTransfer({
        amount: amount, // Paystack service converts to kobo
        recipientCode,
        reference: withdrawalReference,
        reason: 'Bidoro Seller Payout',
      });

      if (transferResult.success) {
        // Update withdrawal with Paystack info
        await supabase
          .from('withdrawals')
          .update({
            status: 'processing',
            paystack_transfer_code: transferResult.data.transfer_code,
            paystack_reference: transferResult.data.reference,
            processed_at: new Date().toISOString(),
            paystack_response: transferResult.data,
          })
          .eq('withdrawal_id', withdrawal.withdrawal_id);

        // Update wallet transaction status
        await supabase
          .from('wallet_transactions')
          .update({ status: 'processing' })
          .eq('reference', withdrawalReference);
      } else {
        // Transfer failed, reverse the hold
        await supabase
          .from('seller_wallets')
          .update({ 
            available_balance: wallet.available_balance,
            updated_at: new Date().toISOString()
          })
          .eq('wallet_id', wallet.wallet_id);

        await supabase
          .from('withdrawals')
          .update({
            status: 'failed',
            failed_at: new Date().toISOString(),
            failure_reason: transferResult.error,
          })
          .eq('withdrawal_id', withdrawal.withdrawal_id);

        await supabase
          .from('wallet_transactions')
          .update({ 
            status: 'failed',
            balance_after: wallet.available_balance
          })
          .eq('reference', withdrawalReference);

        return { success: false, error: transferResult.error || 'Transfer failed' };
      }

      return {
        success: true,
        data: {
          withdrawal_id: withdrawal.withdrawal_id,
          reference: withdrawalReference,
          amount: amount,
          bank_name: bankAccount.bank_name,
          account_number: bankAccount.account_number,
          account_name: bankAccount.account_name,
          status: 'processing',
        },
      };
    } catch (error: any) {
      console.error('Initiate withdrawal error:', error);
      return { success: false, error: error.message || 'Failed to process withdrawal' };
    }
  },

  /**
   * Handle withdrawal webhook (from Paystack)
   */
  async handleWithdrawalWebhook(
    reference: string,
    status: 'success' | 'failed' | 'reversed',
    data: any
  ): Promise<WalletResult> {
    try {
      // Get withdrawal
      const { data: withdrawal, error } = await supabase
        .from('withdrawals')
        .select('*, seller_wallets(*)')
        .eq('reference', reference)
        .single();

      if (error || !withdrawal) {
        return { success: false, error: 'Withdrawal not found' };
      }

      const wallet = withdrawal.seller_wallets;

      if (status === 'success') {
        // Update withdrawal status
        await supabase
          .from('withdrawals')
          .update({
            status: 'successful',
            completed_at: new Date().toISOString(),
            paystack_response: data,
          })
          .eq('withdrawal_id', withdrawal.withdrawal_id);

        // Update total withdrawn
        await supabase
          .from('seller_wallets')
          .update({
            total_withdrawn: wallet.total_withdrawn + withdrawal.amount,
            updated_at: new Date().toISOString(),
          })
          .eq('wallet_id', wallet.wallet_id);

        // Update wallet transaction
        await supabase
          .from('wallet_transactions')
          .update({ status: 'completed' })
          .eq('reference', reference);

      } else if (status === 'failed' || status === 'reversed') {
        // Reverse the hold - add back to available balance
        await supabase
          .from('seller_wallets')
          .update({
            available_balance: wallet.available_balance + withdrawal.amount,
            updated_at: new Date().toISOString(),
          })
          .eq('wallet_id', wallet.wallet_id);

        // Update withdrawal status
        await supabase
          .from('withdrawals')
          .update({
            status: status === 'reversed' ? 'reversed' : 'failed',
            failed_at: new Date().toISOString(),
            failure_reason: data.message || `Transfer ${status}`,
            paystack_response: data,
          })
          .eq('withdrawal_id', withdrawal.withdrawal_id);

        // Update wallet transaction
        await supabase
          .from('wallet_transactions')
          .update({
            status: status === 'reversed' ? 'reversed' : 'failed',
            balance_after: wallet.available_balance + withdrawal.amount,
          })
          .eq('reference', reference);
      }

      return { success: true, data: { status } };
    } catch (error: any) {
      console.error('Handle withdrawal webhook error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get withdrawal history
   */
  async getWithdrawals(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      status?: string;
    } = {}
  ): Promise<WalletResult> {
    try {
      const { page = 1, limit = 20, status } = options;
      const offset = (page - 1) * limit;

      let query = supabase
        .from('withdrawals')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('Get withdrawals error:', error);
        return { success: false, error: 'Failed to get withdrawals' };
      }

      return {
        success: true,
        data: {
          withdrawals: data?.map(w => ({
            id: w.withdrawal_id,
            amount: toNaira(w.amount),
            bank_name: w.bank_name,
            account_number: w.account_number,
            account_name: w.account_name,
            reference: w.reference,
            status: w.status,
            failure_reason: w.failure_reason,
            created_at: w.created_at,
            completed_at: w.completed_at,
          })) || [],
          pagination: {
            page,
            limit,
            total: count || 0,
            totalPages: Math.ceil((count || 0) / limit),
          },
        },
      };
    } catch (error: any) {
      console.error('Get withdrawals error:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get wallet statistics
   */
  async getWalletStats(userId: string): Promise<WalletResult> {
    try {
      const walletResult = await this.getOrCreateWallet(userId);
      if (!walletResult.success) {
        return walletResult;
      }

      // Get monthly earnings
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data: monthlyTransactions } = await supabase
        .from('wallet_transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('type', 'escrow_release')
        .eq('status', 'completed')
        .gte('created_at', startOfMonth.toISOString());

      const monthlyEarnings = monthlyTransactions?.reduce(
        (sum, tx) => sum + tx.amount, 0
      ) || 0;

      // Get successful orders count this month
      const { count: monthlyOrders } = await supabase
        .from('escrow_transactions')
        .select('*', { count: 'exact', head: true })
        .eq('seller_id', userId)
        .eq('status', 'released')
        .gte('released_at', startOfMonth.toISOString());

      // Get pending payouts (funded escrows)
      const { data: pendingEscrows } = await supabase
        .from('escrow_transactions')
        .select('seller_amount')
        .eq('seller_id', userId)
        .eq('status', 'funded');

      const pendingPayouts = pendingEscrows?.reduce(
        (sum, e) => sum + e.seller_amount, 0
      ) || 0;

      return {
        success: true,
        data: {
          ...walletResult.data,
          monthly_earnings: toNaira(monthlyEarnings),
          monthly_orders: monthlyOrders || 0,
          pending_payouts: toNaira(pendingPayouts),
        },
      };
    } catch (error: any) {
      console.error('Get wallet stats error:', error);
      return { success: false, error: error.message };
    }
  },
};

export default walletService;