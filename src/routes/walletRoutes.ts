// backend/routes/walletRoutes.ts
// ============================================
// BIDORO WALLET API ROUTES
// ============================================

import express, { Response } from 'express';
import { AuthRequest, authenticateToken } from '../middleware/auth';
import walletService from '../services/walletService';
import { supabaseAdmin as supabase } from '../config/database';

const router = express.Router();

// ============================================
// Get Wallet Summary
// GET /api/wallet
// ============================================
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const result = await walletService.getWalletSummary(userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error: any) {
    console.error('Get wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet',
    });
  }
});

// ============================================
// Get Wallet Statistics
// GET /api/wallet/stats
// ============================================
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const result = await walletService.getWalletStats(userId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error: any) {
    console.error('Get wallet stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wallet statistics',
    });
  }
});

// ============================================
// Get Transactions
// GET /api/wallet/transactions
// ============================================
router.get('/transactions', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      page = '1',
      limit = '20',
      type,
      status,
      startDate,
      endDate,
    } = req.query;

    const result = await walletService.getTransactions(userId, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      type: type as string,
      status: status as string,
      startDate: startDate as string,
      endDate: endDate as string,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error: any) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transactions',
    });
  }
});

// ============================================
// Get Single Transaction
// GET /api/wallet/transactions/:transactionId
// ============================================
router.get('/transactions/:transactionId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { transactionId } = req.params;

    const { data: transaction, error } = await supabase
      .from('wallet_transactions')
      .select(`
        *,
        escrow:escrow_transactions(
          escrow_id,
          status,
          order:orders(
            order_id,
            product:products(product_name)
          )
        )
      `)
      .eq('transaction_id', transactionId)
      .eq('user_id', userId)
      .single();

    if (error || !transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    res.json({
      success: true,
      data: {
        ...transaction,
        amount: transaction.amount / 100,
        balance_after: transaction.balance_after / 100,
      },
    });
  } catch (error: any) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction',
    });
  }
});

// ============================================
// Initiate Withdrawal
// POST /api/wallet/withdraw
// ============================================
router.post('/withdraw', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { amount, bankAccountId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
      });
    }

    // Check if user is a verified seller
    const { data: user } = await supabase
      .from('users')
      .select('kyc_status, role')
      .eq('user_id', userId)
      .single();

    if (!user || user.kyc_status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Only verified sellers can make withdrawals',
      });
    }

    const result = await walletService.initiateWithdrawal({
      userId,
      amount: parseFloat(amount),
      bankAccountId: bankAccountId ? parseInt(bankAccountId) : undefined,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      message: 'Withdrawal initiated successfully',
      data: result.data,
    });
  } catch (error: any) {
    console.error('Withdraw error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process withdrawal',
    });
  }
});

// ============================================
// Get Withdrawal History
// GET /api/wallet/withdrawals
// ============================================
router.get('/withdrawals', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { page = '1', limit = '20', status } = req.query;

    const result = await walletService.getWithdrawals(userId, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      status: status as string,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error,
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error: any) {
    console.error('Get withdrawals error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get withdrawals',
    });
  }
});

// ============================================
// Get Single Withdrawal
// GET /api/wallet/withdrawals/:withdrawalId
// ============================================
router.get('/withdrawals/:withdrawalId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { withdrawalId } = req.params;

    const { data: withdrawal, error } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('withdrawal_id', withdrawalId)
      .eq('user_id', userId)
      .single();

    if (error || !withdrawal) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal not found',
      });
    }

    res.json({
      success: true,
      data: {
        ...withdrawal,
        amount: withdrawal.amount / 100,
      },
    });
  } catch (error: any) {
    console.error('Get withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get withdrawal',
    });
  }
});

// ============================================
// Get Bank Accounts
// GET /api/wallet/bank-accounts
// ============================================
router.get('/bank-accounts', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data: accounts, error } = await supabase
      .from('seller_bank_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('is_primary', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: accounts || [],
    });
  } catch (error: any) {
    console.error('Get bank accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bank accounts',
    });
  }
});

// ============================================
// Set Primary Bank Account
// PUT /api/wallet/bank-accounts/:accountId/primary
// ============================================
router.put('/bank-accounts/:accountId/primary', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { accountId } = req.params;

    // Reset all accounts to non-primary
    await supabase
      .from('seller_bank_accounts')
      .update({ is_primary: false })
      .eq('user_id', userId);

    // Set the selected account as primary
    const { data: account, error } = await supabase
      .from('seller_bank_accounts')
      .update({ is_primary: true })
      .eq('idx', accountId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !account) {
      return res.status(404).json({
        success: false,
        message: 'Bank account not found',
      });
    }

    res.json({
      success: true,
      message: 'Primary bank account updated',
      data: account,
    });
  } catch (error: any) {
    console.error('Set primary bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bank account',
    });
  }
});

// ============================================
// Get Earnings by Period
// GET /api/wallet/earnings
// ============================================
router.get('/earnings', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { period = 'month' } = req.query; // 'week', 'month', 'year'

    let startDate = new Date();
    
    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(startDate.getMonth() - 1);
    }

    // Get earnings for the period
    const { data: transactions, error } = await supabase
      .from('wallet_transactions')
      .select('amount, created_at')
      .eq('user_id', userId)
      .eq('type', 'escrow_release')
      .eq('status', 'completed')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    // Calculate daily earnings
    const dailyEarnings: Record<string, number> = {};
    let totalEarnings = 0;

    transactions?.forEach(tx => {
      const date = new Date(tx.created_at).toISOString().split('T')[0];
      dailyEarnings[date] = (dailyEarnings[date] || 0) + tx.amount;
      totalEarnings += tx.amount;
    });

    // Get order count
    const { count: orderCount } = await supabase
      .from('escrow_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('seller_id', userId)
      .eq('status', 'released')
      .gte('released_at', startDate.toISOString());

    res.json({
      success: true,
      data: {
        period,
        total_earnings: totalEarnings / 100,
        order_count: orderCount || 0,
        daily_breakdown: Object.entries(dailyEarnings).map(([date, amount]) => ({
          date,
          amount: amount / 100,
        })),
      },
    });
  } catch (error: any) {
    console.error('Get earnings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get earnings',
    });
  }
});

export default router;