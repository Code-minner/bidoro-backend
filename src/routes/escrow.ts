// src/routes/escrow.ts

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { escrowService, calculateFees } from '../services/escrowService';
import { paystackService } from '../services/paystackService';
import { paystackConfig } from '../config/paystack';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * POST /api/escrow/initialize
 * Initialize escrow payment for an order
 */
router.post('/initialize', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, productId, sellerId, amount } = req.body;
    const buyerId = req.user!.id;
    const buyerEmail = req.user!.email;

    // Validation
    if (!orderId || !productId || !sellerId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: orderId, productId, sellerId, amount',
      });
    }

    if (amount < 100) {
      return res.status(400).json({
        success: false,
        error: 'Minimum order amount is ₦100',
      });
    }

    if (buyerId === sellerId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot purchase your own product',
      });
    }

    const result = await escrowService.createEscrowPayment({
      buyerId,
      sellerId,
      productId,
      orderId,
      amount,
      buyerEmail,
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Payment initialized',
      data: result.data,
    });
  } catch (error) {
    console.error('Initialize payment error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/escrow/verify/:reference
 * Verify payment after redirect from Paystack
 */
router.get('/verify/:reference', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { reference } = req.params;

    const verifyResult = await paystackService.verifyTransaction(reference);

    if (!verifyResult.success) {
      return res.status(400).json({
        success: false,
        error: 'Payment verification failed',
      });
    }

    const { status, metadata } = verifyResult.data;

    if (status === 'success') {
      await escrowService.handlePaymentSuccess(reference, verifyResult.data);

      return res.json({
        success: true,
        message: 'Payment successful',
        data: {
          reference,
          escrowId: metadata.escrow_id,
          orderId: metadata.order_id,
        },
      });
    }

    res.status(400).json({
      success: false,
      error: `Payment ${status}`,
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/escrow/webhook
 * Paystack webhook handler
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    // Verify webhook signature
    const hash = crypto
      .createHmac('sha512', paystackConfig.secretKey)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.error('Invalid webhook signature');
      return res.sendStatus(400);
    }

    const event = req.body;
    console.log('Paystack webhook event:', event.event);

    switch (event.event) {
      case 'charge.success':
        const { reference, metadata } = event.data;
        if (metadata?.type === 'escrow_payment') {
          await escrowService.handlePaymentSuccess(reference, event.data);
        }
        break;

      case 'transfer.success':
        console.log('Transfer successful:', event.data.reference);
        break;

      case 'transfer.failed':
        console.error('Transfer failed:', event.data);
        break;

      case 'refund.processed':
        console.log('Refund processed:', event.data.reference);
        break;

      default:
        console.log('Unhandled webhook event:', event.event);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.sendStatus(500);
  }
});

/**
 * POST /api/escrow/:escrowId/ship
 * Seller marks order as shipped
 */
router.post('/:escrowId/ship', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { escrowId } = req.params;
    const { trackingNumber, deliveryCompany } = req.body;
    const sellerId = req.user!.id;

    const trackingInfo = trackingNumber ? { trackingNumber, deliveryCompany } : undefined;

    const result = await escrowService.markAsShipped(escrowId, sellerId, trackingInfo);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Order marked as shipped',
      data: result.data,
    });
  } catch (error) {
    console.error('Ship order error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/escrow/:escrowId/confirm
 * Buyer confirms delivery - triggers payout
 */
router.post('/:escrowId/confirm', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { escrowId } = req.params;
    const buyerId = req.user!.id;

    const result = await escrowService.confirmDelivery(escrowId, buyerId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Delivery confirmed. Funds released to seller.',
      data: result.data,
    });
  } catch (error) {
    console.error('Confirm delivery error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * POST /api/escrow/:escrowId/dispute
 * Buyer opens dispute
 */
router.post('/:escrowId/dispute', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { escrowId } = req.params;
    const { reason } = req.body;
    const buyerId = req.user!.id;

    if (!reason || reason.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a detailed reason (at least 10 characters)',
      });
    }

    const result = await escrowService.openDispute(escrowId, buyerId, reason);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Dispute opened. Our team will review and contact you.',
      data: result.data,
    });
  } catch (error) {
    console.error('Open dispute error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/escrow/:escrowId
 * Get escrow details
 */
router.get('/:escrowId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { escrowId } = req.params;
    const userId = req.user!.id;

    const result = await escrowService.getEscrowById(escrowId, userId);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error('Get escrow error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/escrow
 * Get user's escrow transactions
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { role, status } = req.query;

    const result = await escrowService.getUserEscrows(
      userId, 
      role as 'buyer' | 'seller' | 'both', 
      status as string
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error('Get escrows error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

/**
 * GET /api/escrow/fees/calculate
 * Calculate fees for an amount
 */
router.get('/fees/calculate', async (req: Request, res: Response) => {
  try {
    const amount = parseFloat(req.query.amount as string);

    if (!amount || amount < 100) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount required (min ₦100)',
      });
    }

    const fees = calculateFees(amount);

    res.json({
      success: true,
      data: fees,
    });
  } catch (error) {
    console.error('Calculate fees error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

export default router;