// src/routes/sellerBankAccount.ts
// Seller bank account management with Paystack integration

import { Router, Response } from 'express';
import { supabaseAdmin as supabase } from '../config/database';
import { authenticateToken, AuthRequest, requireVerifiedSeller } from '../middleware/auth';
import { paystackService } from '../services/paystackService';

const router = Router();

/**
 * GET /api/seller/bank-account
 * Get seller's current bank account
 */
router.get('/bank-account', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data: bankAccount, error } = await supabase
      .from('seller_bank_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_primary', true)
      .single();

    if (error || !bankAccount) {
      return res.json({
        success: true,
        data: null,
        message: 'No bank account found'
      });
    }

    // Mask account number for security
    const maskedAccount = {
      account_name: bankAccount.account_name,
      account_number: bankAccount.account_number.slice(-4).padStart(10, '*'),
      account_number_full: bankAccount.account_number, // Only for display, remove in production if needed
      bank_name: bankAccount.bank_name,
      bank_code: bankAccount.bank_code,
      is_verified: !!bankAccount.paystack_recipient_code,
      status: bankAccount.status,
    };

    res.json({
      success: true,
      data: maskedAccount
    });
  } catch (error) {
    console.error('Get bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bank account'
    });
  }
});

/**
 * GET /api/seller/banks
 * Get list of Nigerian banks from Paystack
 */
router.get('/banks', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await paystackService.getBanks();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch banks'
      });
    }

    // Return simplified bank list
    const banks = result.data.map((bank: any) => ({
      code: bank.code,
      name: bank.name,
    }));

    res.json({
      success: true,
      data: banks
    });
  } catch (error) {
    console.error('Get banks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch banks'
    });
  }
});

/**
 * POST /api/seller/bank-account/verify
 * Verify bank account details with Paystack
 */
router.post('/bank-account/verify', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { accountNumber, bankCode } = req.body;

    if (!accountNumber || !bankCode) {
      return res.status(400).json({
        success: false,
        message: 'Account number and bank code are required'
      });
    }

    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Account number must be 10 digits'
      });
    }

    const result = await paystackService.verifyBankAccount(accountNumber, bankCode);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Could not verify account. Please check the details.'
      });
    }

    res.json({
      success: true,
      data: {
        account_number: result.data.account_number,
        account_name: result.data.account_name,
      }
    });
  } catch (error) {
    console.error('Verify bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed. Please try again.'
    });
  }
});

/**
 * POST /api/seller/bank-account
 * Add or update seller's bank account with Paystack recipient creation
 */
router.post('/bank-account', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { accountNumber, bankCode, bankName, accountName } = req.body;

    // Validation
    if (!accountNumber || !bankCode || !bankName || !accountName) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: accountNumber, bankCode, bankName, accountName'
      });
    }

    if (!/^\d{10}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Account number must be 10 digits'
      });
    }

    // Check if user is a verified seller
    const { data: user } = await supabase
      .from('users')
      .select('role, kyc_status')
      .eq('user_id', userId)
      .single();

    if (!user || user.role !== 'seller' || user.kyc_status !== 'verified') {
      return res.status(403).json({
        success: false,
        message: 'Only verified sellers can update bank accounts'
      });
    }

    // Get seller profile
    const { data: profile } = await supabase
      .from('seller_profiles')
      .select('profile_id')
      .eq('user_id', userId)
      .single();

    if (!profile) {
      return res.status(400).json({
        success: false,
        message: 'Seller profile not found'
      });
    }

    // 1. Verify account with Paystack first
    console.log(`\n=== UPDATING BANK ACCOUNT FOR USER ${userId} ===`);
    
    const verifyResult = await paystackService.verifyBankAccount(accountNumber, bankCode);
    
    if (!verifyResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Could not verify bank account'
      });
    }

    const verifiedAccountName = verifyResult.data.account_name;
    console.log(`✅ Account verified: ${verifiedAccountName}`);

    // 2. Create Paystack transfer recipient
    let paystackRecipientCode: string | null = null;

    try {
      const recipientResult = await paystackService.createTransferRecipient({
        name: verifiedAccountName,
        accountNumber,
        bankCode,
      });

      if (recipientResult.success) {
        paystackRecipientCode = recipientResult.data.recipient_code;
        console.log(`✅ Paystack recipient created: ${paystackRecipientCode}`);
      } else {
        console.error('❌ Failed to create Paystack recipient:', recipientResult.error);
        return res.status(500).json({
          success: false,
          message: 'Failed to setup payout account. Please try again.'
        });
      }
    } catch (paystackError) {
      console.error('❌ Paystack API error:', paystackError);
      return res.status(500).json({
        success: false,
        message: 'Payment service error. Please try again.'
      });
    }

    // 3. Set all existing accounts as non-primary
    await supabase
      .from('seller_bank_accounts')
      .update({ is_primary: false })
      .eq('user_id', userId);

    // 4. Check if this exact account already exists
    const { data: existingAccount } = await supabase
      .from('seller_bank_accounts')
      .select('account_id')
      .eq('user_id', userId)
      .eq('account_number', accountNumber)
      .eq('bank_code', bankCode)
      .single();

    let bankAccount;

    if (existingAccount) {
      // Update existing account
      const { data, error } = await supabase
        .from('seller_bank_accounts')
        .update({
          bank_name: bankName,
          account_name: verifiedAccountName,
          paystack_recipient_code: paystackRecipientCode,
          is_primary: true,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', existingAccount.account_id)
        .select()
        .single();

      if (error) throw error;
      bankAccount = data;
      console.log(`✅ Updated existing bank account`);
    } else {
      // Create new account
      const { data, error } = await supabase
        .from('seller_bank_accounts')
        .insert({
          user_id: userId,
          profile_id: profile.profile_id,
          account_number: accountNumber,
          bank_code: bankCode,
          bank_name: bankName,
          account_name: verifiedAccountName,
          paystack_recipient_code: paystackRecipientCode,
          is_primary: true,
          status: 'active',
        })
        .select()
        .single();

      if (error) throw error;
      bankAccount = data;
      console.log(`✅ Created new bank account`);
    }

    console.log(`=== BANK ACCOUNT UPDATE COMPLETED ===\n`);

    res.json({
      success: true,
      message: 'Bank account updated successfully',
      data: {
        account_name: bankAccount.account_name,
        account_number: accountNumber.slice(-4).padStart(10, '*'),
        bank_name: bankAccount.bank_name,
        is_verified: true,
      }
    });
  } catch (error) {
    console.error('Update bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bank account'
    });
  }
});

/**
 * DELETE /api/seller/bank-account
 * Delete seller's bank account
 */
router.delete('/bank-account', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Check if there are pending escrows
    const { data: pendingEscrows } = await supabase
      .from('escrow_transactions')
      .select('id')
      .eq('seller_id', userId)
      .in('status', ['escrow_held', 'shipped', 'delivered', 'pending_payout'])
      .limit(1);

    if (pendingEscrows && pendingEscrows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete bank account while you have pending orders or payouts'
      });
    }

    // Soft delete - just mark as inactive
    const { error } = await supabase
      .from('seller_bank_accounts')
      .update({ 
        status: 'inactive',
        is_primary: false,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('is_primary', true);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Bank account removed'
    });
  } catch (error) {
    console.error('Delete bank account error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete bank account'
    });
  }
});

export default router;