import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface BankData {
  id: number;
  code: string;
  name: string;
}

interface VerifyAccountResponse {
  status: string;
  message: string;
  data: {
    account_number: string;
    account_name: string;
  };
}

interface SubaccountData {
  bankCode: string;
  accountNumber: string;
  businessName: string;
  email: string;
  phoneNumber?: string;
  splitPercentage?: number;
}

interface SubaccountResponse {
  status: string;
  message: string;
  data: {
    id: number;
    account_number: string;
    account_bank: string;
    business_name: string;
    fullname: string;
    created_at: string;
    meta: any[];
    subaccount_id: string;
    split_type: string;
    split_value: number;
    bank_name: string;
  };
}

class FlutterwaveService {
  private axiosInstance: AxiosInstance;
  private baseURL: string;
  private secretKey: string;

  constructor() {
    this.baseURL = process.env.FLUTTERWAVE_BASE_URL || 'https://api.flutterwave.com/v3';
    this.secretKey = process.env.FLUTTERWAVE_SECRET_KEY || '';

    if (!this.secretKey) {
      throw new Error('FLUTTERWAVE_SECRET_KEY is not defined in environment variables');
    }

    this.axiosInstance = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // Get list of banks
  async getBanks(country: string = 'NG'): Promise<BankData[]> {
    try {
      const response = await this.axiosInstance.get(`/banks/${country}`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Failed to fetch banks');
    }
  }

  // Verify account number
  async verifyAccount(accountNumber: string, bankCode: string): Promise<VerifyAccountResponse['data']> {
    try {
      const response = await this.axiosInstance.post<VerifyAccountResponse>('/accounts/resolve', {
        account_number: accountNumber,
        account_bank: bankCode,
      });
      return response.data.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Account verification failed');
    }
  }

  // Create subaccount for seller
  async createSubaccount(data: SubaccountData): Promise<SubaccountResponse['data']> {
    try {
      const response = await this.axiosInstance.post<SubaccountResponse>('/subaccounts', {
        account_bank: data.bankCode,
        account_number: data.accountNumber,
        business_name: data.businessName,
        business_email: data.email,
        business_mobile: data.phoneNumber || '',
        country: 'NG',
        split_type: 'percentage',
        split_value: data.splitPercentage || 0.90, // 90% to seller
      });
      return response.data.data;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Subaccount creation failed');
    }
  }
}

export default new FlutterwaveService();