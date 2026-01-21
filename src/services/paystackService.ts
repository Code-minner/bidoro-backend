// src/services/paystackService.ts

import axios from 'axios';
import { paystackConfig, paystackHeaders } from '../config/paystack';

const paystackAPI = axios.create({
  baseURL: paystackConfig.baseUrl,
  headers: paystackHeaders,
});

interface InitializeTransactionParams {
  email: string;
  amount: number;
  reference: string;
  metadata?: Record<string, any>;
  callbackUrl?: string;
}

interface TransferParams {
  amount: number;
  recipientCode: string;
  reference: string;
  reason?: string;
}

interface CreateRecipientParams {
  name: string;
  accountNumber: string;
  bankCode: string;
}

export const paystackService = {
  /**
   * Initialize a payment transaction
   */
  async initializeTransaction({ email, amount, reference, metadata, callbackUrl }: InitializeTransactionParams) {
    try {
      const response = await paystackAPI.post('/transaction/initialize', {
        email,
        amount: Math.round(amount * 100), // Convert to kobo
        reference,
        callback_url: callbackUrl,
        metadata,
      });
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Paystack initialize error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || 'Payment initialization failed' };
    }
  },

  /**
   * Verify a transaction
   */
  async verifyTransaction(reference: string) {
    try {
      const response = await paystackAPI.get(`/transaction/verify/${reference}`);
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Paystack verify error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || 'Verification failed' };
    }
  },

  /**
   * Get list of banks
   */
  async getBanks() {
    try {
      const response = await paystackAPI.get('/bank?country=nigeria');
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Paystack get banks error:', error.response?.data || error.message);
      return { success: false, error: 'Failed to fetch banks' };
    }
  },

  /**
   * Verify bank account
   */
  async verifyBankAccount(accountNumber: string, bankCode: string) {
    try {
      const response = await paystackAPI.get('/bank/resolve', {
        params: { account_number: accountNumber, bank_code: bankCode },
      });
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Paystack verify account error:', error.response?.data || error.message);
      return { success: false, error: 'Could not verify account' };
    }
  },

  /**
   * Create transfer recipient (for seller payouts)
   */
  async createTransferRecipient({ name, accountNumber, bankCode }: CreateRecipientParams) {
    try {
      const response = await paystackAPI.post('/transferrecipient', {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
      });
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Paystack create recipient error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || 'Failed to create recipient' };
    }
  },

  /**
   * Initiate transfer to seller (payout)
   */
  async initiateTransfer({ amount, recipientCode, reference, reason }: TransferParams) {
    try {
      const response = await paystackAPI.post('/transfer', {
        source: 'balance',
        amount: Math.round(amount * 100), // Convert to kobo
        recipient: recipientCode,
        reference,
        reason: reason || 'Bidoro Escrow Payout',
      });
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Paystack transfer error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || 'Transfer failed' };
    }
  },

  /**
   * Check Paystack balance
   */
  async checkBalance() {
    try {
      const response = await paystackAPI.get('/balance');
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Paystack balance error:', error.response?.data || error.message);
      return { success: false, error: 'Failed to fetch balance' };
    }
  },

  /**
   * Initiate refund
   */
  async initiateRefund(transactionReference: string, amount?: number) {
    try {
      const response = await paystackAPI.post('/refund', {
        transaction: transactionReference,
        amount: amount ? Math.round(amount * 100) : undefined,
      });
      return { success: true, data: response.data.data };
    } catch (error: any) {
      console.error('Paystack refund error:', error.response?.data || error.message);
      return { success: false, error: error.response?.data?.message || 'Refund failed' };
    }
  },
};

export default paystackService;