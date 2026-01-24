// =============================================
// BIDORO Referral Utils
// Location: backend/utils/referral.utils.ts
// WITH NOTIFICATION INTEGRATION
// =============================================

import { supabaseAdmin as supabase } from '../config/database';
import { notificationService } from '../services/notification.service';

interface ReferralResult {
  success: boolean;
  pointsEarned: number;
  message: string;
}

/**
 * Called when a new user signs up with a referral code
 */
export async function onUserSignup(newUserId: string, referralCode: string): Promise<ReferralResult> {
  try {
    // Find the referrer by their referral code
    const { data: referrer, error: referrerError } = await supabase
      .from('users')
      .select('user_id, name, total_points, referral_count')
      .eq('referral_code', referralCode.toUpperCase())
      .single();

    if (referrerError || !referrer) {
      return {
        success: false,
        pointsEarned: 0,
        message: 'Invalid referral code'
      };
    }

    // Don't allow self-referral
    if (referrer.user_id === newUserId) {
      return {
        success: false,
        pointsEarned: 0,
        message: 'Cannot use your own referral code'
      };
    }

    // Check if this user was already referred
    const { data: existingReferral } = await supabase
      .from('referral_history')
      .select('id')
      .eq('referred_user_id', newUserId)
      .single();

    if (existingReferral) {
      return {
        success: false,
        pointsEarned: 0,
        message: 'User already has a referrer'
      };
    }

    // Points configuration
    const REFERRER_SIGNUP_POINTS = 100;
    const REFERRED_SIGNUP_POINTS = 50;

    // Get new user's name for notification
    const { data: newUser } = await supabase
      .from('users')
      .select('name')
      .eq('user_id', newUserId)
      .single();

    const newUserName = newUser?.name || 'A new user';

    // Record the referral
    await supabase.from('referral_history').insert({
      referrer_id: referrer.user_id,
      referred_user_id: newUserId,
      referral_type: 'signup',
      points_earned: REFERRER_SIGNUP_POINTS,
      status: 'completed'
    });

    // Update referrer's points
    await supabase
      .from('users')
      .update({
        total_points: (referrer.total_points || 0) + REFERRER_SIGNUP_POINTS,
        redeemable_points: supabase.rpc('increment_points', { amount: REFERRER_SIGNUP_POINTS }),
        referral_count: (referrer.referral_count || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', referrer.user_id);

    // Update new user's points and set their referrer
    await supabase
      .from('users')
      .update({
        referred_by: referrer.user_id,
        total_points: REFERRED_SIGNUP_POINTS,
        redeemable_points: REFERRED_SIGNUP_POINTS,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', newUserId);

    // =============================================
    // SEND NOTIFICATIONS
    // =============================================
    
    // Notify referrer
    try {
      await notificationService.createReferralNotification(
        referrer.user_id,
        'signup',
        newUserName,
        REFERRER_SIGNUP_POINTS
      );
    } catch (notifError) {
      console.error('Failed to send referral notification to referrer:', notifError);
    }

    // Notify new user about their bonus
    try {
      await notificationService.createNotification({
        user_id: newUserId,
        title: 'Welcome Bonus! 🎁',
        message: `You earned ${REFERRED_SIGNUP_POINTS} points for signing up with a referral code!`,
        category: 'referral',
        type: 'success',
        action_url: '/earn',
        metadata: {
          points_earned: REFERRED_SIGNUP_POINTS,
          referrer_name: referrer.name
        }
      });
    } catch (notifError) {
      console.error('Failed to send welcome bonus notification:', notifError);
    }

    return {
      success: true,
      pointsEarned: REFERRED_SIGNUP_POINTS,
      message: `You earned ${REFERRED_SIGNUP_POINTS} bonus points!`
    };
  } catch (error) {
    console.error('Referral signup error:', error);
    return {
      success: false,
      pointsEarned: 0,
      message: 'Failed to process referral'
    };
  }
}

/**
 * Called when a referred user makes their first purchase
 */
export async function onFirstPurchase(userId: string, orderAmount: number): Promise<ReferralResult> {
  try {
    // Get user and check if they were referred
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('user_id, name, referred_by')
      .eq('user_id', userId)
      .single();

    if (userError || !user || !user.referred_by) {
      return {
        success: false,
        pointsEarned: 0,
        message: 'User has no referrer'
      };
    }

    // Check if purchase bonus was already given
    const { data: existingBonus } = await supabase
      .from('referral_history')
      .select('id')
      .eq('referred_user_id', userId)
      .eq('referral_type', 'first_purchase')
      .single();

    if (existingBonus) {
      return {
        success: false,
        pointsEarned: 0,
        message: 'First purchase bonus already claimed'
      };
    }

    // Points configuration
    const REFERRER_PURCHASE_POINTS = 250;
    const BUYER_PURCHASE_POINTS = 100;

    // Get referrer info
    const { data: referrer } = await supabase
      .from('users')
      .select('user_id, name, total_points')
      .eq('user_id', user.referred_by)
      .single();

    if (!referrer) {
      return {
        success: false,
        pointsEarned: 0,
        message: 'Referrer not found'
      };
    }

    // Record the purchase referral
    await supabase.from('referral_history').insert({
      referrer_id: referrer.user_id,
      referred_user_id: userId,
      referral_type: 'first_purchase',
      points_earned: REFERRER_PURCHASE_POINTS,
      status: 'completed',
      metadata: { order_amount: orderAmount }
    });

    // Update referrer's points
    await supabase
      .from('users')
      .update({
        total_points: (referrer.total_points || 0) + REFERRER_PURCHASE_POINTS,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', referrer.user_id);

    // Update buyer's points
    const { data: buyerData } = await supabase
      .from('users')
      .select('total_points')
      .eq('user_id', userId)
      .single();

    await supabase
      .from('users')
      .update({
        total_points: (buyerData?.total_points || 0) + BUYER_PURCHASE_POINTS,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    // =============================================
    // SEND NOTIFICATIONS
    // =============================================
    
    // Notify referrer about purchase bonus
    try {
      await notificationService.createReferralNotification(
        referrer.user_id,
        'purchase',
        user.name || 'Your referral',
        REFERRER_PURCHASE_POINTS
      );
    } catch (notifError) {
      console.error('Failed to send purchase referral notification:', notifError);
    }

    // Notify buyer about their bonus
    try {
      await notificationService.createNotification({
        user_id: userId,
        title: 'First Purchase Bonus! 🛒',
        message: `You earned ${BUYER_PURCHASE_POINTS} points for your first purchase!`,
        category: 'referral',
        type: 'success',
        action_url: '/earn',
        metadata: {
          points_earned: BUYER_PURCHASE_POINTS,
          order_amount: orderAmount
        }
      });
    } catch (notifError) {
      console.error('Failed to send purchase bonus notification:', notifError);
    }

    return {
      success: true,
      pointsEarned: BUYER_PURCHASE_POINTS,
      message: `You earned ${BUYER_PURCHASE_POINTS} bonus points for your first purchase!`
    };
  } catch (error) {
    console.error('First purchase referral error:', error);
    return {
      success: false,
      pointsEarned: 0,
      message: 'Failed to process referral bonus'
    };
  }
}

/**
 * Validate a referral code without applying it
 */
export async function validateReferralCode(code: string, userId?: string): Promise<{
  valid: boolean;
  referrerName?: string;
  message: string;
}> {
  try {
    const { data: referrer, error } = await supabase
      .from('users')
      .select('user_id, name')
      .eq('referral_code', code.toUpperCase())
      .single();

    if (error || !referrer) {
      return {
        valid: false,
        message: 'Invalid referral code'
      };
    }

    // Check if trying to use own code
    if (userId && referrer.user_id === userId) {
      return {
        valid: false,
        message: 'Cannot use your own referral code'
      };
    }

    return {
      valid: true,
      referrerName: referrer.name,
      message: `Referral code from ${referrer.name}`
    };
  } catch (error) {
    console.error('Validate referral code error:', error);
    return {
      valid: false,
      message: 'Error validating referral code'
    };
  }
}