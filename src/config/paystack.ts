// src/config/paystack.ts

export const paystackConfig = {
  secretKey: process.env.PAYSTACK_SECRET_KEY || '',
  publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  baseUrl: 'https://api.paystack.co',

  // Platform fee and auto-release config moved to src/config/pricing.ts
  // Change them there — it's the single source of truth.
};

export const paystackHeaders = {
  Authorization: `Bearer ${paystackConfig.secretKey}`,
  'Content-Type': 'application/json',
};