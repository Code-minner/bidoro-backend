// =============================================
// BIDORO Referral Routes
// =============================================

import { Router } from 'express';
import { referralController } from '../controllers/referral.controller';
import { authenticateToken } from '../middleware/auth'; // Use your existing auth middleware

const router = Router();

// =============================================
// Public Routes (no authentication required)
// =============================================

/**
 * @route   POST /api/referral/validate
 * @desc    Validate a referral code (used during signup)
 * @access  Public
 */
router.post('/validate', referralController.validateCode);

/**
 * @route   GET /api/referral/config
 * @desc    Get referral program configuration
 * @access  Public
 */
router.get('/config', referralController.getConfig);

// =============================================
// Protected Routes (authentication required)
// =============================================

// Apply auth middleware to all routes below
router.use(authenticateToken);

/**
 * @route   GET /api/referral/stats
 * @desc    Get user's referral statistics
 * @access  Private
 */
router.get('/stats', referralController.getStats);

/**
 * @route   GET /api/referral/code
 * @desc    Get user's referral code and link
 * @access  Private
 */
router.get('/code', referralController.getCode);

/**
 * @route   POST /api/referral/apply
 * @desc    Apply a referral code to account
 * @access  Private
 */
router.post('/apply', referralController.applyCode);

/**
 * @route   GET /api/referral/history
 * @desc    Get user's referral history
 * @access  Private
 * @query   page - Page number (default: 1)
 * @query   limit - Items per page (default: 10, max: 50)
 */
router.get('/history', referralController.getHistory);

/**
 * @route   GET /api/referral/points/history
 * @desc    Get user's points transaction history
 * @access  Private
 * @query   page - Page number (default: 1)
 * @query   limit - Items per page (default: 20, max: 100)
 */
router.get('/points/history', referralController.getPointsHistory);

/**
 * @route   POST /api/referral/points/redeem
 * @desc    Redeem points for discount
 * @access  Private
 * @body    points - Number of points to redeem
 */
router.post('/points/redeem', referralController.redeemPoints);

export default router;