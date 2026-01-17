// =============================================
// BIDORO Referral Controller
// =============================================

import { Request, Response, NextFunction } from 'express';
import { referralService } from '../services/referral.service';
import { AuthRequest } from '../middleware/auth'; // Use your existing AuthRequest interface

class ReferralController {
  /**
   * GET /api/referral/stats
   * Get user's referral statistics
   */
  async getStats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const stats = await referralService.getUserReferralStats(userId);

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      console.error('Error fetching referral stats:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch referral stats',
      });
    }
  }

  /**
   * GET /api/referral/code
   * Get user's referral code
   */
  async getCode(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const code = await referralService.getUserReferralCode(userId);
      const baseUrl = process.env.FRONTEND_URL || 'https://bidoro.com.ng';

      return res.status(200).json({
        success: true,
        data: {
          referral_code: code,
          referral_link: `${baseUrl}/signup?ref=${code}`,
        },
      });
    } catch (error: any) {
      console.error('Error fetching referral code:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch referral code',
      });
    }
  }

  /**
   * POST /api/referral/validate
   * Validate a referral code (for signup flow)
   */
  async validateCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Referral code is required',
        });
      }

      const referrer = await referralService.validateReferralCode(code);

      if (!referrer) {
        return res.status(404).json({
          success: false,
          message: 'Invalid referral code',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Valid referral code',
        data: {
          referrer_name: referrer.name?.split(' ')[0] || 'A Bidoro user',
        },
      });
    } catch (error: any) {
      console.error('Error validating referral code:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to validate referral code',
      });
    }
  }

  /**
   * POST /api/referral/apply
   * Apply a referral code to user account
   */
  async applyCode(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const { code } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      if (!code) {
        return res.status(400).json({
          success: false,
          message: 'Referral code is required',
        });
      }

      const result = await referralService.applyReferralCode(userId, code);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message,
        data: {
          points_earned: result.pointsEarned,
        },
      });
    } catch (error: any) {
      console.error('Error applying referral code:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to apply referral code',
      });
    }
  }

  /**
   * GET /api/referral/history
   * Get user's referral history
   */
  async getHistory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { referrals, total } = await referralService.getReferralHistory(
        userId,
        page,
        limit
      );

      return res.status(200).json({
        success: true,
        data: {
          referrals,
          pagination: {
            total,
            page,
            limit,
            total_pages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error: any) {
      console.error('Error fetching referral history:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch referral history',
      });
    }
  }

  /**
   * GET /api/referral/points/history
   * Get user's points transaction history
   */
  async getPointsHistory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      const { transactions, total } = await referralService.getPointsHistory(
        userId,
        page,
        limit
      );

      return res.status(200).json({
        success: true,
        data: {
          transactions,
          pagination: {
            total,
            page,
            limit,
            total_pages: Math.ceil(total / limit),
          },
        },
      });
    } catch (error: any) {
      console.error('Error fetching points history:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch points history',
      });
    }
  }

  /**
   * POST /api/referral/points/redeem
   * Redeem points for discount
   */
  async redeemPoints(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.id;
      const { points } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      if (!points || typeof points !== 'number' || points <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid points amount is required',
        });
      }

      const result = await referralService.redeemPoints(userId, points);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.status(200).json({
        success: true,
        message: result.message,
        data: {
          redemption_code: result.redemptionCode,
          discount_amount: result.discountAmount,
        },
      });
    } catch (error: any) {
      console.error('Error redeeming points:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to redeem points',
      });
    }
  }

  /**
   * GET /api/referral/config
   * Get points configuration (public)
   */
  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const config = await referralService.getPointsConfig();
      const baseUrl = process.env.FRONTEND_URL || 'https://bidoro.com.ng';

      return res.status(200).json({
        success: true,
        data: {
          referrer_signup_points: config.get('referrer_signup_points'),
          referred_signup_points: config.get('referred_signup_points'),
          referrer_purchase_points: config.get('referrer_purchase_points'),
          referred_purchase_points: config.get('referred_purchase_points'),
          points_to_naira_rate: config.get('points_to_naira_rate'),
          min_redemption_points: config.get('min_redemption_points'),
          base_referral_url: `${baseUrl}/signup?ref=`,
        },
      });
    } catch (error: any) {
      console.error('Error fetching config:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to fetch configuration',
      });
    }
  }
}

export const referralController = new ReferralController();
export default ReferralController;