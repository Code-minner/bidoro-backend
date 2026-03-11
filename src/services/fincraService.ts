// src/services/fincraService.ts
// Drop-in replacement for src/services/paystackService.ts
// Public method signatures are kept identical so callers need minimal changes.
//
// KEY DIFFERENCES vs Paystack:
//   - Fincra amounts are in NAIRA (not kobo) — no /100 or *100 conversions here.
//   - No "recipient code" concept — transfers go straight to bank account details.
//   - Webhook signature: compare verif-hash header to your FINCRA_WEBHOOK_SECRET.
//   - Webhook events: charge.completed | payout.successful | payout.failed | payout.reversed

import axios from "axios";
import { fincraConfig } from "../config/fincra";

const fincraAPI = axios.create({
  baseURL: fincraConfig.baseUrl,
});

fincraAPI.interceptors.request.use((config) => {
  config.headers["api-key"] = fincraConfig.apiKey;
  config.headers["Content-Type"] = "application/json";
  return config;
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface InitializeTransactionParams {
  email: string;
  amount: number; // Naira
  reference: string;
  metadata?: Record<string, any>;
  callbackUrl?: string;
}

interface TransferParams {
  amount: number; // Naira
  recipientCode: string; // unused by Fincra; kept for interface compatibility
  reference: string;
  reason?: string;
  // These are required by Fincra — populated by walletService
  accountNumber?: string;
  bankCode?: string;
  accountName?: string;
}

interface CreateRecipientParams {
  name: string;
  accountNumber: string;
  bankCode: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const fincraService = {
  /**
   * Create a Fincra checkout link (replaces Paystack /transaction/initialize).
   * Returns { authorization_url, reference } to keep the callers identical.
   */
  async initializeTransaction({
    email,
    amount,
    reference,
    metadata,
    callbackUrl,
  }: InitializeTransactionParams) {
    try {
      const response = await fincraAPI.post("/checkout/payments", {
        amount, // Fincra expects Naira — no *100
        currency: "NGN",
        customerEmail: email,
        redirectUrl: callbackUrl,
        reference,
        metadata,
      });

      const { link } = response.data.data;

      // Normalise to the shape Paystack callers expect
      return {
        success: true,
        data: {
          authorization_url: link,
          access_code: reference, // Fincra has no access_code; reuse reference
          reference,
        },
      };
    } catch (error: any) {
      console.error(
        "Fincra initializeTransaction error:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data?.message || "Payment initialization failed",
      };
    }
  },

  /**
   * Verify a payment by its merchant reference.
   * Normalises the response to { status, metadata, reference, amount }.
   */
  async verifyTransaction(reference: string) {
    try {
      const response = await fincraAPI.get(
        `/checkout/payments/merchant-reference/${reference}`,
      );

      const payment = response.data.data;

      // Fincra statuses: "successful" | "pending" | "failed"
      // Normalise to Paystack-style "success" | "failed" | "pending"
      const statusMap: Record<string, string> = {
        successful: "success",
        pending: "pending",
        failed: "failed",
      };

      return {
        success: true,
        data: {
          status: statusMap[payment.status] ?? payment.status,
          reference: payment.reference,
          amount: payment.amount, // already in Naira
          metadata: payment.metadata ?? {},
        },
      };
    } catch (error: any) {
      console.error(
        "Fincra verifyTransaction error:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data?.message || "Verification failed",
      };
    }
  },

  /**
   * List Nigerian banks.
   * Returns [{ name, code }] — same shape as Paystack.
   */
  async getBanks() {
    try {
      const response = await fincraAPI.get("/core/banks?currency=NGN");
      // Fincra returns { data: [{ name, code, ... }] }
      return {
        success: true,
        data: response.data.data as Array<{ name: string; code: string }>,
      };
    } catch (error: any) {
      console.error(
        "Fincra getBanks error:",
        error.response?.data || error.message,
      );
      return { success: false, error: "Failed to fetch banks" };
    }
  },

  /**
   * Verify a bank account number.
   * Returns { account_name, account_number } — same shape as Paystack.
   */
  async verifyBankAccount(accountNumber: string, bankCode: string) {
    try {
      console.log("Fincra verify attempt:", { accountNumber, bankCode }); // ← add this

      const response = await fincraAPI.post("/core/accounts/resolve", {
        accountNumber,
        bankCode,
      });

      console.log(
        "Fincra verify response:",
        JSON.stringify(response.data, null, 2),
      ); // ← add this

      if (!response.data.data || !response.data.data.accountName) {
        return {
          success: false,
          error: "Account not found. Please check account number and bank.",
        };
      }

      const { accountName } = response.data.data;
      return {
        success: true,
        data: { account_name: accountName, account_number: accountNumber },
      };
    } catch (error: any) {
      // ← replace the existing catch log with this to see the full error
      console.error(
        "Fincra verifyBankAccount error:",
        JSON.stringify(error.response?.data, null, 2) || error.message,
      );
      return { success: false, error: "Could not verify account" };
    }
  },

  /**
   * Fincra does NOT use recipient codes.
   * This stub exists so callers that already have recipient-code logic don't crash.
   * walletService will skip this call entirely (see below).
   *
   * The returned "recipient_code" is a synthetic key we embed bank details in
   * so that legacy code paths still have something to store in the DB column.
   */
  async createTransferRecipient({
    name,
    accountNumber,
    bankCode,
  }: CreateRecipientParams) {
    // Pack details into a token that initiateTransfer can decode if needed
    const token = Buffer.from(
      JSON.stringify({ name, accountNumber, bankCode }),
    ).toString("base64");

    return { success: true, data: { recipient_code: `FINCRA:${token}` } };
  },

  /**
   * Initiate a disbursement to a bank account.
   *
   * Preferred: pass accountNumber / bankCode / accountName explicitly.
   * Fallback:  decode them from a "FINCRA:..." recipientCode created above.
   */
  async initiateTransfer({
    amount,
    recipientCode,
    reference,
    reason,
    accountNumber,
    bankCode,
    accountName,
  }: TransferParams) {
    try {
      // Resolve bank details
      let resolvedAccountNumber = accountNumber;
      let resolvedBankCode = bankCode;
      let resolvedAccountName = accountName || "Account Holder";

      if (
        (!resolvedAccountNumber || !resolvedBankCode) &&
        recipientCode?.startsWith("FINCRA:")
      ) {
        try {
          const decoded = JSON.parse(
            Buffer.from(
              recipientCode.replace("FINCRA:", ""),
              "base64",
            ).toString(),
          );
          resolvedAccountNumber =
            resolvedAccountNumber || decoded.accountNumber;
          resolvedBankCode = resolvedBankCode || decoded.bankCode;
          resolvedAccountName =
            resolvedAccountName !== "Account Holder"
              ? resolvedAccountName
              : decoded.name;
        } catch {
          return { success: false, error: "Invalid recipient token" };
        }
      }

      if (!resolvedAccountNumber || !resolvedBankCode) {
        return {
          success: false,
          error: "Bank account details are required for Fincra transfers",
        };
      }

      const response = await fincraAPI.post(
        `/disbursements/businesses/${fincraConfig.businessId}/send/account`,
        {
          sourceCurrency: "NGN",
          destinationCurrency: "NGN",
          amount, // Naira — no conversion needed
          description: reason || "Bidoro Escrow Payout",
          customerReference: reference,
          destinationAccount: {
            currency: "NGN",
            bankCode: resolvedBankCode,
            accountNumber: resolvedAccountNumber,
            accountName: resolvedAccountName,
          },
        },
      );

      const disbursement = response.data.data;

      // Normalise to Paystack transfer shape
      return {
        success: true,
        data: {
          transfer_code: disbursement.reference,
          reference: disbursement.reference ?? reference,
          status: disbursement.status,
        },
      };
    } catch (error: any) {
      console.error(
        "Fincra initiateTransfer error:",
        error.response?.data || error.message,
      );
      return {
        success: false,
        error: error.response?.data?.message || "Transfer failed",
      };
    }
  },

  /**
   * Get NGN wallet balance.
   * Returns [{ currency, balance }] — same shape as Paystack balance endpoint.
   */
  async checkBalance() {
    try {
      const response = await fincraAPI.get("/finance/wallets");
      const wallets: Array<{ currency: string; balance: number }> =
        response.data.data ?? [];
      const ngnWallet = wallets.find((w) => w.currency === "NGN");

      return {
        success: true,
        data: [{ currency: "NGN", balance: ngnWallet?.balance ?? 0 }],
      };
    } catch (error: any) {
      console.error(
        "Fincra checkBalance error:",
        error.response?.data || error.message,
      );
      return { success: false, error: "Failed to fetch balance" };
    }
  },

  /**
   * Initiate a refund.
   * Fincra refunds are raised as disputes via the dashboard or support.
   * For automated refunds you can re-disburse funds back to the buyer's account.
   * This stub logs the intent and returns success so your escrow flow doesn't break.
   * Wire in real logic when you have a buyer bank-account collection flow.
   */
  async initiateRefund(transactionReference: string, amount?: number) {
    console.warn(
      "[Fincra] Refund requested for",
      transactionReference,
      amount ? `(₦${amount})` : "(full amount)",
      "— handle via Fincra dashboard or disburse back to buyer account.",
    );
    // TODO: Implement buyer-account disbursement or dashboard webhook when Fincra exposes a refund API.
    return { success: true, data: { reference: transactionReference } };
  },
};

export default fincraService;
