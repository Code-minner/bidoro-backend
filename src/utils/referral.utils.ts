// =============================================
// BIDORO Referral Utilities
// Helper functions for referral processing
// =============================================

import { referralService } from '../services/referral.service';

/**
 * Utility to be called when a new order is completed
 * This processes referral rewards for first-time purchases
 */
export const onOrderCompleted = async (
  userId: string,
  orderId: string,
  orderTotal: number
): Promise<void> => {
  try {
    console.log(`Processing referral rewards for order ${orderId}`);
    
    // Process first purchase rewards
    await referralService.processFirstPurchaseRewards(userId, orderId);
    
    console.log(`Referral rewards processed for order ${orderId}`);
  } catch (error) {
    // Log error but don't throw - referral processing shouldn't break order flow
    console.error('Error processing referral rewards:', error);
  }
};

/**
 * Utility to be called during user signup
 * Applies referral code if provided during registration
 */
export const onUserSignup = async (
  userId: string,
  referralCode?: string
): Promise<{ pointsEarned?: number }> => {
  if (!referralCode) {
    return {};
  }

  try {
    console.log(`Applying referral code ${referralCode} for user ${userId}`);
    
    const result = await referralService.applyReferralCode(userId, referralCode);
    
    if (result.success) {
      console.log(`Referral code applied successfully. Points earned: ${result.pointsEarned}`);
      return { pointsEarned: result.pointsEarned };
    } else {
      console.log(`Failed to apply referral code: ${result.message}`);
      return {};
    }
  } catch (error) {
    console.error('Error applying referral code during signup:', error);
    return {};
  }
};

export default {
  onOrderCompleted,
  onUserSignup,
};