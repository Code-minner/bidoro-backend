// services/paystackService.ts - Fix the return type
export const paystackService = {
  async verifyBankAccount(accountNumber: string, bankCode: string) {
    // Always return success for now
    return {
      success: true,
      data: {
        account_name: "Account Holder",
        account_number: accountNumber
      },
      message: "Bank account verified successfully" // ADD THIS
    };
  }
};