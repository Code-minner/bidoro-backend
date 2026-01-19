// =============================================
// BIDORO Referral System Types
// =============================================

export interface User {
  user_id: string;
  email: string;
  name: string;
  referral_code: string;
  referred_by?: string;
  total_points: number;
  redeemable_points: number;
  referral_count: number;
  active_referrals: number;
  account_status?: string;
  created_at: Date;
  updated_at: Date;
}

export type ReferralStatus = 'pending' | 'active' | 'completed' | 'expired';

export interface Referral {
  id: string;
  referrer_id: string;
  referred_id: string;
  status: ReferralStatus;
  referrer_points_earned: number;
  referred_points_earned: number;
  first_purchase_completed: boolean;
  first_purchase_date?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ReferralWithDetails extends Referral {
  referred_user: {
    full_name: string;
    email: string;
  };
}

export type PointTransactionType = 
  | 'referral_signup'
  | 'referral_purchase'
  | 'welcome_bonus'
  | 'redemption'
  | 'expired'
  | 'adjustment';

export interface PointTransaction {
  id: string;
  user_id: string;
  referral_id?: string;
  transaction_type: PointTransactionType;
  points: number;
  balance_after: number;
  description?: string;
  metadata?: Record<string, any>;
  created_at: Date;
}

export interface PointsConfig {
  id: string;
  config_key: string;
  config_value: number;
  description?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// API Request/Response Types
export interface ApplyReferralCodeRequest {
  referral_code: string;
}

export interface ReferralStatsResponse {
  total_points: number;
  redeemable_points: number;
  points_value_naira: number;
  referral_count: number;
  active_referrals: number;
  referral_code: string;
  referral_link: string;
}

export interface ReferralHistoryItem {
  id: string;
  referred_name: string;
  referred_email: string;
  status: ReferralStatus;
  points_earned: number;
  points_value_naira: number;
  date: Date;
}

export interface ReferralHistoryResponse {
  referrals: ReferralHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface PointsHistoryResponse {
  transactions: PointTransaction[];
  total: number;
  page: number;
  limit: number;
}

export interface RedeemPointsRequest {
  points: number;
}

export interface RedeemPointsResponse {
  success: boolean;
  redeemed_points: number;
  discount_amount_naira: number;
  remaining_points: number;
  redemption_code: string;
}

// Config keys enum for type safety
export enum PointsConfigKey {
  REFERRER_SIGNUP_POINTS = 'referrer_signup_points',
  REFERRED_SIGNUP_POINTS = 'referred_signup_points',
  REFERRER_PURCHASE_POINTS = 'referrer_purchase_points',
  REFERRED_PURCHASE_POINTS = 'referred_purchase_points',
  POINTS_TO_NAIRA_RATE = 'points_to_naira_rate',
  MIN_REDEMPTION_POINTS = 'min_redemption_points',
  POINTS_EXPIRY_DAYS = 'points_expiry_days',
}