// src/config/paystack.ts

export const paystackConfig = {
  secretKey: process.env.PAYSTACK_SECRET_KEY || '',
  publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  baseUrl: 'https://api.paystack.co',
  
  // Platform settings
  platformFeePercent: 5, // 5% platform fee
  autoReleaseDays: 5,    // Auto-release to seller after 5 days
};

export const paystackHeaders = {
  Authorization: `Bearer ${paystackConfig.secretKey}`,
  'Content-Type': 'application/json',
};