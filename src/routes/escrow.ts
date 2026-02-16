// ================================================
// BIDORO - ESCROW API ROUTES (SYNCED)
// File: src/routes/escrow.ts
//
// FEE MODEL:
//   8.2% platform commission is calculated internally
//   by escrowService using src/config/pricing.ts.
//   No fee params needed from the client.
// ================================================

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { escrowService } from "../services/escrowService";
import { paystackService } from "../services/paystackService";
import { paystackConfig } from "../config/paystack";
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
      const buyerId = req.user!.id;
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

      // 8.2% split is calculated inside escrowService
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

      const verifyResult = await paystackService.verifyTransaction(reference);
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
// ================================================
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const hash = crypto
      .createHmac("sha512", paystackConfig.secretKey)
      .update(JSON.stringify(req.body))
      .digest("hex");

    const signature = String(req.headers["x-paystack-signature"] || "");
    if (hash !== signature) {
      console.error("Invalid webhook signature");
      return res.sendStatus(400);
    }

    const event = req.body;
    console.log("Paystack webhook event:", event.event);

    switch (event.event) {
      case "charge.success": {
        const { reference, metadata } = event.data;
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

      case "transfer.success": {
        const ref = event.data.reference;
        if (ref?.startsWith("WTH")) {
          await walletService.handleWithdrawalWebhook(ref, "success", event.data);
        }
        if (ref?.startsWith("PAY")) {
          console.log("Escrow payout completed:", ref);
        }
        break;
      }

      case "transfer.failed": {
        const ref = event.data.reference;
        if (ref?.startsWith("WTH")) {
          await walletService.handleWithdrawalWebhook(ref, "failed", event.data);
        }
        if (ref?.startsWith("PAY")) {
          console.error("Escrow payout failed, will retry:", ref);
        }
        break;
      }

      case "transfer.reversed": {
        const ref = event.data.reference;
        if (ref?.startsWith("WTH")) {
          await walletService.handleWithdrawalWebhook(ref, "reversed", event.data);
        }
        break;
      }

      case "refund.processed":
        console.log("Refund processed:", event.data.reference);
        break;

      default:
        console.log("Unhandled webhook event:", event.event);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(200);
  }
});

// ================================================
// POST /api/escrow/:escrowId/ship
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
// POST /api/escrow/:escrowId/confirm
// ================================================
router.post(
  "/:escrowId/confirm",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const buyerId = req.user!.id;

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
// POST /api/escrow/:escrowId/dispute
// ================================================
router.post(
  "/:escrowId/dispute",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const { reason } = req.body;
      const buyerId = req.user!.id;

      if (!reason || reason.length < 10) {
        return res.status(400).json({ success: false, error: "Please provide a detailed reason (at least 10 characters)" });
      }

      const result = await escrowService.openDispute(escrowId, buyerId, reason);
      if (!result.success) return res.status(400).json(result);
      res.json({ success: true, message: "Dispute opened. Our team will review and contact you.", data: result.data });
    } catch (error) {
      console.error("Open dispute error:", error);
      res.status(500).json({ success: false, error: "Server error" });
    }
  }
);

// ================================================
// POST /api/escrow/:escrowId/resolve (admin only)
// ================================================
router.post(
  "/:escrowId/resolve",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const { resolution, outcome } = req.body;
      const adminId = req.user!.id;

      // Verify admin role
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
        return res.status(400).json({ success: false, error: `Invalid outcome. Must be: ${validOutcomes.join(", ")}` });
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
// GET /api/escrow/:escrowId
// ================================================
router.get(
  "/:escrowId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const escrowId = String(req.params.escrowId);
      const userId = req.user!.id;

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
// GET /api/escrow
// ================================================
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const role = req.query.role ? String(req.query.role) as "buyer" | "seller" | "both" : "both";
    const status = req.query.status ? String(req.query.status) : undefined;

    const result = await escrowService.getUserEscrows(
      userId,
      role,
      status
    );

    if (!result.success) return res.status(400).json(result);
    res.json({ success: true, data: result.data });
  } catch (error) {
    console.error("Get escrows error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ================================================
// GET /api/escrow/fees/calculate
// Public endpoint to show fee breakdown for an amount
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