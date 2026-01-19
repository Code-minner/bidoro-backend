// =============================================
// BIDORO Referral Service
// =============================================

import { supabaseAdmin as supabase } from '../config/database'; // Use your existing database config
import {
  User,
  Referral,
  ReferralWithDetails,
  PointTransaction,
  PointsConfig,
  ReferralStatus,
  PointTransactionType,
  ReferralStatsResponse,
  ReferralHistoryItem,
  PointsConfigKey,
} from '../types/referral.types';

class ReferralService {
  // =============================================
  // Configuration Methods
  // =============================================

  /**
   * Get all points configuration
   */
  async getPointsConfig(): Promise<Map<string, number>> {
    const { data, error } = await supabase
      .from('points_config')
      .select('*')
      .eq('is_active', true);

    if (error) throw new Error(`Failed to fetch points config: ${error.message}`);

    const configMap = new Map<string, number>();
    data?.forEach((config: PointsConfig) => {
      configMap.set(config.config_key, config.config_value);
    });

    return configMap;
  }

  /**
   * Get specific config value
   */
  async getConfigValue(key: PointsConfigKey): Promise<number> {
    const { data, error } = await supabase
      .from('points_config')
      .select('config_value')
      .eq('config_key', key)
      .eq('is_active', true)
      .single();

    if (error) throw new Error(`Failed to fetch config ${key}: ${error.message}`);
    return data.config_value;
  }

  // =============================================
  // User Referral Methods
  // =============================================

  /**
   * Get user's referral code
   */
  async getUserReferralCode(userId: string): Promise<string> {
    const { data, error } = await supabase
      .from('users')
      .select('referral_code')
      .eq('user_id', userId)
      .single();

    if (error) throw new Error(`Failed to fetch referral code: ${error.message}`);
    return data.referral_code;
  }

  /**
   * Get user's referral statistics
   */
  async getUserReferralStats(userId: string): Promise<ReferralStatsResponse> {
    const { data: user, error } = await supabase
      .from('users')
      .select('referral_code, total_points, redeemable_points, referral_count, active_referrals')
      .eq('user_id', userId)
      .single();

    if (error) throw new Error(`Failed to fetch user stats: ${error.message}`);

    const pointsToNaira = await this.getConfigValue(PointsConfigKey.POINTS_TO_NAIRA_RATE);
    const baseUrl = process.env.FRONTEND_URL || 'https://bidoro.com.ng';

    return {
      total_points: user.total_points,
      redeemable_points: user.redeemable_points,
      points_value_naira: user.redeemable_points * pointsToNaira,
      referral_count: user.referral_count,
      active_referrals: user.active_referrals,
      referral_code: user.referral_code,
      referral_link: `${baseUrl}/register?ref=${user.referral_code}`,
    };
  }

  /**
   * Validate referral code and get referrer
   */
  async validateReferralCode(code: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('referral_code', code.toUpperCase())
      .single();

    if (error || !data) return null;
    return data;
  }

  /**
   * Apply referral code during signup
   */
  async applyReferralCode(
    newUserId: string,
    referralCode: string
  ): Promise<{ success: boolean; message: string; pointsEarned?: number }> {
    // Validate referral code
    const referrer = await this.validateReferralCode(referralCode);
    
    if (!referrer) {
      return { success: false, message: 'Invalid referral code' };
    }

    // Prevent self-referral
    if (referrer.user_id === newUserId) {
      return { success: false, message: 'Cannot use your own referral code' };
    }

    // Check if user already has a referrer
    const { data: existingUser } = await supabase
      .from('users')
      .select('referred_by')
      .eq('user_id', newUserId)
      .single();

    if (existingUser?.referred_by) {
      return { success: false, message: 'Referral code already applied' };
    }

    // Get config values
    const config = await this.getPointsConfig();
    const referrerSignupPoints = config.get(PointsConfigKey.REFERRER_SIGNUP_POINTS) || 100;
    const referredSignupPoints = config.get(PointsConfigKey.REFERRED_SIGNUP_POINTS) || 50;

    // Start transaction
    try {
      // Update new user with referrer
      const { error: updateError } = await supabase
        .from('users')
        .update({ referred_by: referrer.user_id })
        .eq('user_id', newUserId);

      if (updateError) throw updateError;

      // Create referral record
      const { data: referral, error: referralError } = await supabase
        .from('referrals')
        .insert({
          referrer_id: referrer.user_id,
          referred_id: newUserId,
          status: 'pending',
          referrer_points_earned: referrerSignupPoints,
          referred_points_earned: referredSignupPoints,
        })
        .select()
        .single();

      if (referralError) throw referralError;

      // Award points to referrer
      await this.awardPoints(
        referrer.user_id,
        referrerSignupPoints,
        'referral_signup',
        `Referral signup bonus`,
        referral.id
      );

      // Award points to new user
      await this.awardPoints(
        newUserId,
        referredSignupPoints,
        'welcome_bonus',
        `Welcome bonus from referral`,
        referral.id
      );

      return {
        success: true,
        message: 'Referral code applied successfully',
        pointsEarned: referredSignupPoints,
      };
    } catch (error: any) {
      console.error('Error applying referral code:', error);
      return { success: false, message: 'Failed to apply referral code' };
    }
  }

  // =============================================
  // Points Management Methods
  // =============================================

  /**
   * Award points to a user
   */
  async awardPoints(
    userId: string,
    points: number,
    transactionType: PointTransactionType,
    description: string,
    referralId?: string,
    metadata?: Record<string, any>
  ): Promise<PointTransaction> {
    // Get current balance
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('total_points, redeemable_points')
      .eq('user_id', userId)
      .single();

    if (userError) throw new Error(`Failed to fetch user: ${userError.message}`);

    const newTotalPoints = user.total_points + points;
    const newRedeemablePoints = user.redeemable_points + points;

    // Update user points
    const { error: updateError } = await supabase
      .from('users')
      .update({
        total_points: newTotalPoints,
        redeemable_points: newRedeemablePoints,
      })
      .eq('user_id', userId);

    if (updateError) throw new Error(`Failed to update points: ${updateError.message}`);

    // Create transaction record
    const { data: transaction, error: transError } = await supabase
      .from('point_transactions')
      .insert({
        user_id: userId,
        referral_id: referralId,
        transaction_type: transactionType,
        points: points,
        balance_after: newRedeemablePoints,
        description: description,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (transError) throw new Error(`Failed to create transaction: ${transError.message}`);

    return transaction;
  }

  /**
   * Deduct points from user (for redemption)
   */
  async deductPoints(
    userId: string,
    points: number,
    description: string
  ): Promise<{ success: boolean; message: string; newBalance?: number }> {
    // Get current balance
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('redeemable_points')
      .eq('user_id', userId)
      .single();

    if (userError) throw new Error(`Failed to fetch user: ${userError.message}`);

    if (user.redeemable_points < points) {
      return { success: false, message: 'Insufficient points' };
    }

    const newBalance = user.redeemable_points - points;

    // Update user points
    const { error: updateError } = await supabase
      .from('users')
      .update({ redeemable_points: newBalance })
      .eq('user_id', userId);

    if (updateError) throw new Error(`Failed to update points: ${updateError.message}`);

    // Create transaction record
    await supabase.from('point_transactions').insert({
      user_id: userId,
      transaction_type: 'redemption',
      points: -points,
      balance_after: newBalance,
      description: description,
    });

    return { success: true, message: 'Points redeemed successfully', newBalance };
  }

  /**
   * Process first purchase rewards
   */
  async processFirstPurchaseRewards(
    userId: string,
    orderId: string
  ): Promise<void> {
    // Find pending referral for this user
    const { data: referral, error } = await supabase
      .from('referrals')
      .select('*')
      .eq('referred_id', userId)
      .eq('status', 'pending')
      .single();

    if (error || !referral) {
      // No pending referral, nothing to process
      return;
    }

    // Get config values
    const config = await this.getPointsConfig();
    const referrerPurchasePoints = config.get(PointsConfigKey.REFERRER_PURCHASE_POINTS) || 250;
    const referredPurchasePoints = config.get(PointsConfigKey.REFERRED_PURCHASE_POINTS) || 100;

    // Update referral status
    await supabase
      .from('referrals')
      .update({
        status: 'active',
        first_purchase_completed: true,
        first_purchase_date: new Date().toISOString(),
        referrer_points_earned: referral.referrer_points_earned + referrerPurchasePoints,
        referred_points_earned: referral.referred_points_earned + referredPurchasePoints,
      })
      .eq('id', referral.id);

    // Award bonus points to referrer
    await this.awardPoints(
      referral.referrer_id,
      referrerPurchasePoints,
      'referral_purchase',
      `Referral first purchase bonus (Order: ${orderId})`,
      referral.id,
      { order_id: orderId }
    );

    // Award bonus points to referred user
    await this.awardPoints(
      userId,
      referredPurchasePoints,
      'referral_purchase',
      `First purchase bonus`,
      referral.id,
      { order_id: orderId }
    );
  }

  // =============================================
  // History & Reporting Methods
  // =============================================

  /**
   * Get user's referral history
   */
  async getReferralHistory(
    userId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ referrals: ReferralHistoryItem[]; total: number }> {
    const offset = (page - 1) * limit;
    const pointsToNaira = await this.getConfigValue(PointsConfigKey.POINTS_TO_NAIRA_RATE);

    // Get referrals with referred user details
    const { data, error, count } = await supabase
      .from('referrals')
      .select(
        `
        id,
        status,
        referrer_points_earned,
        created_at,
        referred_user:referred_id (
          name,
          email
        )
      `,
        { count: 'exact' }
      )
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to fetch referral history: ${error.message}`);

    const referrals: ReferralHistoryItem[] = (data || []).map((ref: any) => ({
      id: ref.id,
      referred_name: ref.referred_user?.name || 'Unknown',
      referred_email: ref.referred_user?.email || '',
      status: ref.status,
      points_earned: ref.referrer_points_earned,
      points_value_naira: ref.referrer_points_earned * pointsToNaira,
      date: ref.created_at,
    }));

    return { referrals, total: count || 0 };
  }

  /**
   * Get user's points transaction history
   */
  async getPointsHistory(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ transactions: PointTransaction[]; total: number }> {
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('point_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to fetch points history: ${error.message}`);

    return { transactions: data || [], total: count || 0 };
  }

  // =============================================
  // Redemption Methods
  // =============================================

  /**
   * Redeem points for discount
   */
  async redeemPoints(
    userId: string,
    points: number
  ): Promise<{
    success: boolean;
    message: string;
    redemptionCode?: string;
    discountAmount?: number;
  }> {
    const config = await this.getPointsConfig();
    const minRedemption = config.get(PointsConfigKey.MIN_REDEMPTION_POINTS) || 500;
    const pointsToNaira = config.get(PointsConfigKey.POINTS_TO_NAIRA_RATE) || 1;

    if (points < minRedemption) {
      return {
        success: false,
        message: `Minimum redemption is ${minRedemption} points`,
      };
    }

    const result = await this.deductPoints(
      userId,
      points,
      `Redeemed ${points} points for discount`
    );

    if (!result.success) {
      return result;
    }

    // Generate unique redemption code
    const redemptionCode = `BDR-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}`;

    const discountAmount = points * pointsToNaira;

    // Store redemption code (you might want to create a separate table for this)
    await supabase.from('point_transactions').update({
      metadata: { redemption_code: redemptionCode, discount_amount: discountAmount },
    });

    return {
      success: true,
      message: 'Points redeemed successfully',
      redemptionCode,
      discountAmount,
    };
  }
}

export const referralService = new ReferralService();
export default ReferralService;