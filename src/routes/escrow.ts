// src/routes/escrow.ts  (updated for Fincra)
//
// Changes from Paystack version:
//   1. Import fincraService / fincraConfig instead of paystack equivalents
//   2. Webhook signature: compare verif-hash header to FINCRA_WEBHOOK_SECRET (plain equality)
//   3. Webhook events:  charge.success     → charge.completed
//                       transfer.success   → payout.successful
//                       transfer.failed    → payout.failed
//                       transfer.reversed  → payout.reversed
//   4. Webhook data shape: payout reference is in event.data.customerReference
// ================================================

import { Router, Request, Response } from "express";
import { escrowService } from "../services/escrowService";
import { fincraService } from "../services/fincraService";
import { fincraConfig } from "../config/fincra";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { calculateEscrowSplit } from "../config/pricing";
import walletService from "../services/walletService";

const router = Router();

// ================================================
// POST /api/escrow/initialize
// ================================================
router.post(
  "/initialize",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const { orderId, productId, sellerId, amount } = req.body;
      const buyerId    = req.user!.id;
      const buyerEmail = req.user!.email;

      if (!orderId || !sellerId || !amount) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: orderId, sellerId, amount",
        });
      }

      if (amount < 100) {
        return res.status(400).json({ success: false, error: "Minimum order amount is NGN 100" });
      }

      if (buyerId === sellerId) {
        return res.status(400).json({ success: false, error: "You cannot purchase your own product" });
      }

      // 8.2% split calculated inside escrowService (unchanged)
      const result = await escrowService.createEscrowPayment({
        buyerId,
        sellerId,
        productId,
        orderId,
        amount,
        buyerEmail,
      });

      if (!result.success) return res.status(400).json(result);

      res.json({ success: true, message: "Payment initialized", data: result.data });
    } catch (error) {
      console.error("Initialize payment error:", error);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

// ================================================
// GET /api/escrow/verify/:reference
// ================================================
router.get(
  "/verify/:reference",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const reference = String(req.params.reference);

      const verifyResult = await fincraService.verifyTransaction(reference);
      if (!verifyResult.success) {
        return res.status(400).json({ success: false, error: "Payment verification failed" });
      }

      const { status, metadata } = verifyResult.data;

      if (status === "success") {
        await escrowService.handlePaymentSuccess(reference, verifyResult.data);

        if (metadata?.seller_id) {
          const escrowResult = await escrowService.getEscrowByOrderId(metadata.order_id);
          if (escrowResult.data) {
            await escrowService.holdEscrowInWallet(metadata.seller_id, escrowResult.data.seller_amount);
          }
        }

        return res.json({
          success: true,
          message: "Payment successful",
          data: { reference, escrowId: metadata.escrow_id, orderId: metadata.order_id },
        });
      }

      res.status(400).json({ success: false, error: `Payment ${status}` });
    } catch (error) {
      console.error("Verify payment error:", error);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

// ================================================
// POST /api/escrow/webhook
//
// Fincra sends a plain secret in the "verif-hash" header.
// Set FINCRA_WEBHOOK_SECRET in your dashboard under Settings → Webhooks.
// ================================================
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    // ── Signature verification ──────────────────────────────────────────────
    const verifHash = String(req.headers["verif-hash"] || "");

    if (!fincraConfig.webhookSecret || verifHash !== fincraConfig.webhookSecret) {
      console.error("Invalid Fincra webhook signature");
      return res.sendStatus(400);
    }

    const event = req.body;
    console.log("Fincra webhook event:", event.event);

    switch (event.event) {
      // ── Payment collected ─────────────────────────────────────────────────
      case "charge.completed": {
        const { reference, metadata, status } = event.data;

        // Only process successful charges
        if (status !== "successful") break;

        if (metadata?.type === "escrow_payment") {
          await escrowService.handlePaymentSuccess(reference, event.data);

          if (metadata?.seller_id) {
            const escrowResult = await escrowService.getEscrowByOrderId(metadata.order_id);
            if (escrowResult.data) {
              await escrowService.holdEscrowInWallet(metadata.seller_id, escrowResult.data.seller_amount);
            }
          }
        }
        break;
      }

      // ── Payout successful ─────────────────────────────────────────────────
      case "payout.successful": {
        // Fincra puts our reference in customerReference, not reference
        const ref = event.data.customerReference ?? event.data.reference;

        if (ref?.startsWith("WTH")) {
          await walletService.handleWithdrawalWebhook(ref, "success", event.data);
        }
        if (ref?.startsWith("PAY")) {
          console.log("Escrow payout completed:", ref);
        }
        break;
      }

      // ── Payout failed ─────────────────────────────────────────────────────
      case "payout.failed": {
        const ref = event.data.customerReference ?? event.data.reference;

        if (ref?.startsWith("WTH")) {
          await walletService.handleWithdrawalWebhook(ref, "failed", event.data);
        }
        if (ref?.startsWith("PAY")) {
          console.error("Escrow payout failed, will retry:", ref);
        }
        break;
      }

      // ── Payout reversed ───────────────────────────────────────────────────
      case "payout.reversed": {
        const ref = event.data.customerReference ?? event.data.reference;

        if (ref?.startsWith("WTH")) {
          await walletService.handleWithdrawalWebhook(ref, "reversed", event.data);
        }
        break;
      }

      default:
        console.log("Unhandled Fincra webhook event:", event.event);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(200); // Always 200 to stop retries on app errors
  }
});

// ================================================
// POST /api/escrow/:escrowId/ship   (unchanged)
// ================================================
router.post(
  "/:escrowId/ship",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const { trackingNumber, deliveryCompany } = req.body;
      const sellerId = req.user!.id;

      const trackingInfo = trackingNumber ? { trackingNumber, deliveryCompany } : undefined;
      const result = await escrowService.markAsShipped(escrowId, sellerId, trackingInfo);

      if (!result.success) return res.status(400).json(result);
      res.json({ success: true, message: "Order marked as shipped", data: result.data });
    } catch (error) {
      console.error("Ship order error:", error);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

// ================================================
// POST /api/escrow/:escrowId/confirm   (unchanged)
// ================================================
router.post(
  "/:escrowId/confirm",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const buyerId  = req.user!.id;

      const result = await escrowService.confirmDelivery(escrowId, buyerId);
      if (!result.success) return res.status(400).json(result);
      res.json({ success: true, message: "Delivery confirmed. Funds released to seller.", data: result.data });
    } catch (error) {
      console.error("Confirm delivery error:", error);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

// ================================================
// POST /api/escrow/:escrowId/dispute   (unchanged)
// ================================================
router.post(
  "/:escrowId/dispute",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const { reason } = req.body;
      const buyerId   = req.user!.id;

      if (!reason || reason.length < 10) {
        return res.status(400).json({
          success: false,
          error: "Please provide a detailed reason (at least 10 characters)",
        });
      }

      const result = await escrowService.openDispute(escrowId, buyerId, reason);
      if (!result.success) return res.status(400).json(result);
      res.json({
        success: true,
        message: "Dispute opened. Our team will review and contact you.",
        data: result.data,
      });
    } catch (error) {
      console.error("Open dispute error:", error);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

// ================================================
// POST /api/escrow/:escrowId/resolve (admin only)  (unchanged)
// ================================================
router.post(
  "/:escrowId/resolve",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const { resolution, outcome } = req.body;
      const adminId  = req.user!.id;

      const supabaseAdmin = require("../config/database").supabaseAdmin;
      const { data: user } = await supabaseAdmin
        .from("users").select("role").eq("user_id", adminId).single();

      if (!user || user.role !== "admin") {
        return res.status(403).json({ success: false, error: "Only admins can resolve disputes" });
      }

      if (!resolution || !outcome) {
        return res.status(400).json({ success: false, error: "Resolution text and outcome are required" });
      }

      const validOutcomes = ["release_to_seller", "refund_buyer", "partial_refund"];
      if (!validOutcomes.includes(outcome)) {
        return res.status(400).json({
          success: false,
          error: `Invalid outcome. Must be: ${validOutcomes.join(", ")}`,
        });
      }

      const result = await escrowService.resolveDispute(escrowId, adminId, resolution, outcome);
      if (!result.success) return res.status(400).json(result);
      res.json({ success: true, message: "Dispute resolved", data: result.data });
    } catch (error) {
      console.error("Resolve dispute error:", error);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

// ================================================
// GET /api/escrow/:escrowId   (unchanged)
// ================================================
router.get(
  "/:escrowId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const userId   = req.user!.id;

      const result = await escrowService.getEscrowById(escrowId, userId);
      if (!result.success) return res.status(404).json(result);
      res.json({ success: true, data: result.data });
    } catch (error) {
      console.error("Get escrow error:", error);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

// ================================================
// GET /api/escrow   (unchanged)
// ================================================
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const role   = req.query.role ? String(req.query.role) as "buyer" | "seller" | "both" : "both";
    const status = req.query.status ? String(req.query.status) : undefined;

    const result = await escrowService.getUserEscrows(userId, role, status);
    if (!result.success) return res.status(400).json(result);
    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Get escrows error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ================================================
// GET /api/escrow/fees/calculate   (unchanged)
// ================================================
router.get("/fees/calculate", async (req: Request, res: Response) => {
  try {
    const amount = parseFloat(String(req.query.amount || "0"));

    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, error: "Valid amount required (min NGN 100)" });
    }

    const split = calculateEscrowSplit(amount);
    res.json({ success: true, data: split });
  } catch (error) {
    console.error("Calculate fees error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;