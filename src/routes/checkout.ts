// ================================================
// BIDORO - ORDERS API ROUTES (SYNCED)
// File: src/routes/orders.ts
//
// FEE MODEL:
//   Buyer pays: subtotal + delivery (no extra fee)
//   service_fee column stores the 8.2% platform
//   commission for reference — it's deducted from
//   the seller on payout, not added to buyer total.
// ================================================

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { Response } from "express";
import { notificationService } from "../services/notification.service";
import { escrowService } from "../services/escrowService";
import {
  calculateBuyerTotal,
  calculateEscrowSplit,
  PLATFORM_FEE_PERCENT,
  AUTO_RELEASE_DAYS,
} from "../config/pricing";

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ================================================
// STATUS TRANSITIONS
// ================================================
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "shipped", "delivered", "cancelled", "disputed"],
  processing: ["shipped", "delivered", "cancelled", "disputed"],
  shipped: ["delivered", "cancelled", "disputed"],
  delivered: ["completed", "disputed", "returned"],
  completed: ["disputed", "returned"],
  disputed: ["confirmed", "completed", "cancelled"],
  returned: ["completed", "cancelled"],
  cancelled: [],
};

const STATUS_MESSAGES: Record<string, string> = {
  pending: "Order created and awaiting payment",
  confirmed: "Payment confirmed, funds in escrow",
  processing: "Order is being prepared",
  shipped: "Order has been shipped",
  delivered: "Order has been delivered",
  completed: "Order completed successfully",
  disputed: "Dispute has been raised",
  cancelled: "Order has been cancelled",
  returned: "Order has been returned",
};

// ================================================
// HELPERS
// ================================================
function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BDR-${timestamp}-${random}`;
}

async function sendOrderNotification(
  userId: string,
  orderNumber: string,
  status: string,
  role: "buyer" | "seller",
  additionalInfo?: Record<string, any>
) {
  try {
    const templates: Record<string, { title: string; message: string; type: "info" | "success" | "warning" | "error" }> = {
      buyer_pending: { title: "Order Placed", message: `Your order ${orderNumber} has been placed.`, type: "success" },
      buyer_confirmed: { title: "Order Confirmed", message: `Your order ${orderNumber} is confirmed and in escrow.`, type: "success" },
      buyer_shipped: { title: "Order Shipped", message: `Your order ${orderNumber} has been shipped!`, type: "info" },
      buyer_delivered: { title: "Order Delivered", message: `Your order ${orderNumber} has been delivered. Please confirm.`, type: "success" },
      buyer_completed: { title: "Order Completed", message: `Your order ${orderNumber} is complete. Thank you!`, type: "success" },
      buyer_cancelled: { title: "Order Cancelled", message: `Your order ${orderNumber} has been cancelled.`, type: "warning" },
      buyer_disputed: { title: "Dispute Raised", message: `A dispute has been raised for order ${orderNumber}.`, type: "warning" },
      buyer_returned: { title: "Return Initiated", message: `A return has been initiated for order ${orderNumber}.`, type: "info" },
      seller_pending: { title: "New Order!", message: `You have a new order ${orderNumber}.`, type: "success" },
      seller_confirmed: { title: "Payment Confirmed", message: `Payment for order ${orderNumber} is in escrow. Ship the item.`, type: "success" },
      seller_completed: { title: "Order Completed", message: `Order ${orderNumber} completed. Funds released.`, type: "success" },
      seller_cancelled: { title: "Order Cancelled", message: `Order ${orderNumber} has been cancelled.`, type: "warning" },
      seller_disputed: { title: "Dispute Alert", message: `Buyer raised a dispute for order ${orderNumber}.`, type: "error" },
      seller_escrow_released: { title: "Payment Released!", message: `Funds for order ${orderNumber} have been released to your wallet.`, type: "success" },
      seller_returned: { title: "Return Requested", message: `A return has been requested for order ${orderNumber}.`, type: "warning" },
    };

    const template = templates[`${role}_${status}`];
    if (template) {
      await notificationService.createNotification({
        user_id: userId,
        title: template.title,
        message: template.message,
        category: "orders",
        type: template.type,
        action_url: `/orders/${additionalInfo?.orderId || ""}`,
        metadata: { order_number: orderNumber, order_status: status, ...additionalInfo },
      });
    }
  } catch (error) {
    console.error("Failed to send order notification:", error);
  }
}

// ================================================
// GET ALL ORDERS
// ================================================
router.get("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const status = req.query.status ? String(req.query.status) : undefined;
    const view = req.query.view ? String(req.query.view) : "seller";
    const page = req.query.page ? String(req.query.page) : "1";
    const limit = req.query.limit ? String(req.query.limit) : "10";
    const sortBy = req.query.sortBy ? String(req.query.sortBy) : "created_at";
    const sortOrder = req.query.sortOrder ? String(req.query.sortOrder) : "desc";
    const search = req.query.search ? String(req.query.search) : undefined;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from("orders")
      .select(
        `order_id, order_number, buyer_id, seller_id, status, payment_status,
         subtotal, shipping_fee, service_fee, tax_amount, discount_amount,
         total_amount, currency, escrow_amount, payment_reference, payment_method,
         shipping_address, billing_address, delivery_method, tracking_number,
         estimated_delivery, delivered_at, actual_delivery, notes,
         created_at, updated_at`,
        { count: "exact" }
      );

    if (view === "seller") query = query.eq("seller_id", userId);
    else query = query.eq("buyer_id", userId);

    if (status) {
      const aliases: Record<string, string[]> = {
        pending: ["pending"],
        new: ["pending"],
        "in progress": ["confirmed", "processing", "shipped"],
        active: ["confirmed", "processing", "shipped"],
        confirmed: ["confirmed", "processing", "shipped"],
        completed: ["delivered", "completed"],
        delivered: ["delivered", "completed"],
        disputed: ["disputed"],
        cancelled: ["cancelled"],
        canceled: ["cancelled"],
        returned: ["returned"],
      };

      const mapped = aliases[status.toLowerCase()] || [status];
      if (mapped.length === 1) query = query.eq("status", mapped[0]);
      else query = query.in("status", mapped);
    }

    if (search) query = query.ilike("order_number", `%${search}%`);

    query = query.order(sortBy, { ascending: sortOrder === "asc" });
    query = query.range(offset, offset + limitNum - 1);

    const { data: orders, error, count } = await query;
    if (error) throw error;

    // Get items + profiles
    const orderIds = orders?.map((o) => o.order_id) || [];
    let orderItems: any[] = [];
    if (orderIds.length > 0) {
      const { data: items } = await supabase.from("order_items").select("*").in("order_id", orderIds);
      orderItems = items || [];
    }

    const itemsMap = new Map<string, any[]>();
    orderItems.forEach((item) => {
      const items = itemsMap.get(item.order_id) || [];
      items.push(item);
      itemsMap.set(item.order_id, items);
    });

    const participantIds = new Set<string>();
    orders?.forEach((o) => { participantIds.add(o.buyer_id); participantIds.add(o.seller_id); });

    let profiles: any[] = [];
    if (participantIds.size > 0) {
      const { data } = await supabase.from("users").select("user_id, name, email, profile_picture, phone").in("user_id", Array.from(participantIds));
      profiles = data || [];
    }

    const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

    const formatted = orders?.map((order) => {
      const buyer = profileMap.get(order.buyer_id);
      const seller = profileMap.get(order.seller_id);

      return {
        id: order.order_id,
        orderNumber: order.order_number,
        buyer: buyer ? {
          id: order.buyer_id,
          firstName: buyer.name?.split(" ")[0] || "",
          lastName: buyer.name?.split(" ").slice(1).join(" ") || "",
          email: buyer.email, phone: buyer.phone, avatar: buyer.profile_picture,
        } : null,
        seller: seller ? {
          id: order.seller_id,
          firstName: seller.name?.split(" ")[0] || "",
          lastName: seller.name?.split(" ").slice(1).join(" ") || "",
          email: seller.email, avatar: seller.profile_picture,
        } : null,
        items: (itemsMap.get(order.order_id) || []).map((item) => ({
          product: item.product_id, productName: item.product_name,
          productImage: item.product_image, quantity: item.quantity,
          unitPrice: item.unit_price, totalPrice: item.total_price,
        })),
        shippingInfo: order.shipping_address,
        status: order.status,
        paymentStatus: order.payment_status,
        subtotal: Number(order.subtotal) || 0,
        shippingFee: Number(order.shipping_fee) || 0,
        serviceFee: Number(order.service_fee) || 0,
        totalAmount: Number(order.total_amount) || 0,
        currency: order.currency || "NGN",
        escrowAmount: Number(order.escrow_amount) || 0,
        paymentReference: order.payment_reference,
        paymentMethod: order.payment_method,
        deliveryMethod: order.delivery_method,
        trackingNumber: order.tracking_number,
        estimatedDelivery: order.estimated_delivery,
        actualDelivery: order.actual_delivery || order.delivered_at,
        notes: order.notes,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      };
    }) || [];

    const totalPages = Math.ceil((count || 0) / limitNum);

    res.json({
      success: true,
      data: formatted,
      pagination: { page: pageNum, limit: limitNum, total: count || 0, totalPages, hasNext: pageNum < totalPages, hasPrev: pageNum > 1 },
    });
  } catch (error: any) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
});

// ================================================
// GET STATS
// ================================================
router.get("/stats", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    const [totalRes, pendingRes, activeRes, completedRes, disputedRes, escrowRes, curMonthRes, lastMonthRes, curRevRes, lastRevRes, productsRes] = await Promise.all([
      supabase.from("orders").select("order_id", { count: "exact", head: true }).eq("seller_id", userId),
      supabase.from("orders").select("order_id", { count: "exact", head: true }).eq("seller_id", userId).eq("status", "pending"),
      supabase.from("orders").select("order_id", { count: "exact", head: true }).eq("seller_id", userId).in("status", ["confirmed", "processing", "shipped"]),
      supabase.from("orders").select("order_id", { count: "exact", head: true }).eq("seller_id", userId).in("status", ["delivered", "completed"]),
      supabase.from("orders").select("order_id", { count: "exact", head: true }).eq("seller_id", userId).eq("status", "disputed"),
      supabase.from("orders").select("escrow_amount, total_amount").eq("seller_id", userId).eq("payment_status", "paid").in("status", ["confirmed", "processing", "shipped"]),
      supabase.from("orders").select("order_id", { count: "exact", head: true }).eq("seller_id", userId).gte("created_at", startOfMonth),
      supabase.from("orders").select("order_id", { count: "exact", head: true }).eq("seller_id", userId).gte("created_at", startOfLastMonth).lte("created_at", endOfLastMonth),
      supabase.from("orders").select("total_amount").eq("seller_id", userId).in("status", ["delivered", "completed"]).gte("created_at", startOfMonth),
      supabase.from("orders").select("total_amount").eq("seller_id", userId).in("status", ["delivered", "completed"]).gte("created_at", startOfLastMonth).lte("created_at", endOfLastMonth),
      supabase.from("products").select("product_id", { count: "exact", head: true }).eq("seller_id", userId).eq("status", "active"),
    ]);

    const totalEscrow = (escrowRes.data || []).reduce((s, o) => s + (Number(o.escrow_amount) || Number(o.total_amount) || 0), 0);
    const curMonthOrders = curMonthRes.count || 0;
    const lastMonthOrders = lastMonthRes.count || 0;
    const curRevenue = (curRevRes.data || []).reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const lastRevenue = (lastRevRes.data || []).reduce((s, o) => s + (Number(o.total_amount) || 0), 0);

    const ordersChange = lastMonthOrders > 0 ? Math.round(((curMonthOrders - lastMonthOrders) / lastMonthOrders) * 100) : 0;
    const revenueChange = lastRevenue > 0 ? Math.round(((curRevenue - lastRevenue) / lastRevenue) * 100) : 0;

    res.json({
      success: true,
      data: {
        raw: {
          totalOrders: totalRes.count || 0, pendingOrders: pendingRes.count || 0,
          activeOrders: activeRes.count || 0, completedOrders: completedRes.count || 0,
          disputedOrders: disputedRes.count || 0, totalEscrowAmount: totalEscrow,
          totalRevenue: curRevenue, platformFeePercent: PLATFORM_FEE_PERCENT,
          monthlyComparison: { ordersChange, revenueChange },
        },
        cards: [
          { title: "Amount in Escrow", value: `NGN ${totalEscrow.toLocaleString()}`, change: `${Math.abs(revenueChange)}% than last month`, trend: revenueChange >= 0 ? "up" : "down" },
          { title: "Pending Orders", value: String(pendingRes.count || 0), change: `${Math.abs(ordersChange)}% than last month`, trend: ordersChange >= 0 ? "up" : "down" },
          { title: "Completed Orders", value: String(completedRes.count || 0), change: `${Math.abs(ordersChange)}% than last month`, trend: ordersChange >= 0 ? "up" : "down" },
          { title: "Active Products", value: String(productsRes.count || 0), link: "See all >" },
        ],
      },
    });
  } catch (error: any) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ success: false, message: "Failed to fetch statistics" });
  }
});

// ================================================
// GET SINGLE ORDER
// ================================================
router.get("/:orderId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = String(req.params.orderId);
    const userId = req.user!.id;

    const { data: order, error } = await supabase.from("orders").select("*").eq("order_id", orderId).single();
    if (error || !order) return res.status(404).json({ success: false, message: "Order not found" });
    if (order.buyer_id !== userId && order.seller_id !== userId) return res.status(403).json({ success: false, message: "Not authorized" });

    const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId);
    const { data: timeline } = await supabase.from("order_timeline").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
    const { data: dispute } = await supabase.from("order_disputes").select("*").eq("order_id", orderId).maybeSingle();
    const { data: escrowData } = await supabase.from("escrow_transactions").select("id, status, amount, seller_amount, platform_fee, fee_percent, auto_release_at, paid_at, released_at").eq("order_id", orderId).maybeSingle();

    const { data: profilesData } = await supabase.from("users").select("user_id, name, email, profile_picture, phone").in("user_id", [order.buyer_id, order.seller_id]);
    const pMap = new Map((profilesData || []).map((p) => [p.user_id, p]));
    const buyer = pMap.get(order.buyer_id);
    const seller = pMap.get(order.seller_id);

    res.json({
      success: true,
      data: {
        id: order.order_id,
        orderNumber: order.order_number,
        buyer: buyer ? { id: order.buyer_id, firstName: buyer.name?.split(" ")[0] || "", lastName: buyer.name?.split(" ").slice(1).join(" ") || "", email: buyer.email, phone: buyer.phone, avatar: buyer.profile_picture } : null,
        seller: seller ? { id: order.seller_id, firstName: seller.name?.split(" ")[0] || "", lastName: seller.name?.split(" ").slice(1).join(" ") || "", email: seller.email, avatar: seller.profile_picture } : null,
        items: (items || []).map((i) => ({ product: i.product_id, productName: i.product_name, productImage: i.product_image, quantity: i.quantity, unitPrice: i.unit_price, totalPrice: i.total_price })),
        shippingInfo: order.shipping_address,
        status: order.status,
        paymentStatus: order.payment_status,
        subtotal: Number(order.subtotal) || 0,
        shippingFee: Number(order.shipping_fee) || 0,
        serviceFee: Number(order.service_fee) || 0,
        totalAmount: Number(order.total_amount) || 0,
        currency: order.currency || "NGN",
        escrowAmount: Number(order.escrow_amount) || 0,
        escrow: escrowData ? {
          escrowId: escrowData.id, escrowStatus: escrowData.status,
          sellerAmount: escrowData.seller_amount, platformFee: escrowData.platform_fee,
          feePercent: escrowData.fee_percent,
          autoReleaseAt: escrowData.auto_release_at, paidAt: escrowData.paid_at, releasedAt: escrowData.released_at,
        } : null,
        timeline: (timeline || []).map((e) => ({ status: e.status, message: e.message, timestamp: e.created_at, updatedBy: e.updated_by })),
        dispute: dispute ? { reason: dispute.reason, description: dispute.description, raisedBy: dispute.raised_by, raisedAt: dispute.raised_at, resolution: dispute.resolution, resolvedAt: dispute.resolved_at } : null,
        trackingNumber: order.tracking_number,
        estimatedDelivery: order.estimated_delivery,
        actualDelivery: order.actual_delivery || order.delivered_at,
        notes: order.notes,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
      },
    });
  } catch (error: any) {
    console.error("Error fetching order:", error);
    res.status(500).json({ success: false, message: "Failed to fetch order" });
  }
});

// ================================================
// CREATE ORDER
// Buyer total = subtotal + delivery (no extra fee)
// service_fee stores platform commission for reference
// ================================================
router.post("/", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const buyerId = req.user!.id;
    const { sellerId, items, shippingAddress, billingAddress, paymentMethod = "card", deliveryMethod = "standard", shippingFee = 0, notes } = req.body;

    if (!sellerId || !items || !items.length || !shippingAddress) {
      return res.status(400).json({ success: false, message: "Missing required fields: sellerId, items, shippingAddress" });
    }

    const subtotal = items.reduce((sum: number, item: any) => sum + item.quantity * item.unitPrice, 0);

    // Buyer pays subtotal + delivery only
    const totalAmount = calculateBuyerTotal(subtotal, Number(shippingFee));

    // Store the 8.2% commission for reference (deducted from seller on payout)
    const split = calculateEscrowSplit(totalAmount);

    const orderId = uuidv4();
    const orderNumber = generateOrderNumber();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_id: orderId,
        order_number: orderNumber,
        buyer_id: buyerId,
        seller_id: sellerId,
        status: "pending",
        payment_status: "pending",
        subtotal,
        shipping_fee: Number(shippingFee),
        service_fee: split.platformFee,  // 8.2% stored for reference
        tax_amount: 0,
        discount_amount: 0,
        total_amount: totalAmount,        // subtotal + delivery only
        currency: "NGN",
        escrow_amount: 0,
        payment_method: paymentMethod,
        shipping_address: shippingAddress,
        billing_address: billingAddress || shippingAddress,
        delivery_method: deliveryMethod,
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const orderItems = items.map((item: any) => ({
      item_id: uuidv4(),
      order_id: orderId,
      product_id: item.productId,
      product_name: item.productName,
      product_image: item.productImage || null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.quantity * item.unitPrice,
      created_at: new Date().toISOString(),
    }));

    await supabase.from("order_items").insert(orderItems);

    await supabase.from("order_timeline").insert({
      event_id: uuidv4(), order_id: orderId, status: "pending",
      message: "Order created and awaiting payment",
      updated_by: buyerId, created_at: new Date().toISOString(),
    });

    await sendOrderNotification(buyerId, orderNumber, "pending", "buyer", { orderId, totalAmount });
    await sendOrderNotification(sellerId, orderNumber, "pending", "seller", { orderId, totalAmount });

    res.status(201).json({
      success: true,
      message: "Order created",
      data: { id: order.order_id, orderNumber: order.order_number, status: order.status, totalAmount: order.total_amount },
    });
  } catch (error: any) {
    console.error("Error creating order:", error);
    res.status(500).json({ success: false, message: "Failed to create order" });
  }
});

// ================================================
// UPDATE ORDER (actions)
// ================================================
router.patch("/:orderId", authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = String(req.params.orderId);
    const userId = req.user!.id;
    const { action, ...data } = req.body;

    const { data: order, error: fetchError } = await supabase.from("orders").select("*").eq("order_id", orderId).single();
    if (fetchError || !order) return res.status(404).json({ success: false, message: "Order not found" });

    const { data: userRecord } = await supabase.from("users").select("role").eq("user_id", userId).single();
    const isAdmin = userRecord?.role === "admin";
    const isBuyer = order.buyer_id === userId;
    const isSeller = order.seller_id === userId;

    if (!isBuyer && !isSeller && !isAdmin) return res.status(403).json({ success: false, message: "Not authorized" });

    let result;

    switch (action) {
      // ---- UPDATE STATUS ----
      case "updateStatus": {
        const { status, message } = data;
        if (!status) return res.status(400).json({ success: false, message: "Status is required" });

        const frontendToDb: Record<string, string> = {
          new: "pending", active: "confirmed", processing: "processing", shipped: "shipped",
          completed: "delivered", delivered: "delivered", cancelled: "cancelled", canceled: "cancelled",
          disputed: "disputed", returned: "returned", pending: "pending", confirmed: "confirmed",
        };

        const dbStatus = frontendToDb[status] || status;
        const currentStatus = order.status || "pending";

        if (VALID_TRANSITIONS[currentStatus] && !VALID_TRANSITIONS[currentStatus].includes(dbStatus)) {
          return res.status(400).json({ success: false, message: `Cannot change from "${currentStatus}" to "${dbStatus}"` });
        }

        const updateData: any = { status: dbStatus, updated_at: new Date().toISOString() };
        if (dbStatus === "delivered") { updateData.delivered_at = new Date().toISOString(); updateData.actual_delivery = new Date().toISOString(); }

        const { data: updatedOrder, error } = await supabase.from("orders").update(updateData).eq("order_id", orderId).select().single();
        if (error) throw error;

        // SYNC escrow
        const escrowStatusMap: Record<string, string> = { shipped: "shipped", delivered: "delivered", cancelled: "cancelled", disputed: "disputed" };
        if (escrowStatusMap[dbStatus]) {
          const escrowUpdate: any = { status: escrowStatusMap[dbStatus] };
          if (dbStatus === "shipped") escrowUpdate.shipped_at = new Date().toISOString();
          if (dbStatus === "delivered") escrowUpdate.delivered_at = new Date().toISOString();
          if (dbStatus === "disputed") { escrowUpdate.auto_release_at = null; escrowUpdate.dispute_opened_at = new Date().toISOString(); }
          await supabase.from("escrow_transactions").update(escrowUpdate).eq("order_id", orderId);
        }

        await supabase.from("order_timeline").insert({ event_id: uuidv4(), order_id: orderId, status: dbStatus, message: message || STATUS_MESSAGES[dbStatus] || `Status changed to ${dbStatus}`, updated_by: userId, created_at: new Date().toISOString() });
        await sendOrderNotification(order.buyer_id, order.order_number, dbStatus, "buyer", { orderId });
        if (isBuyer) await sendOrderNotification(order.seller_id, order.order_number, dbStatus, "seller", { orderId });

        result = updatedOrder;
        break;
      }

      // ---- CONFIRM PAYMENT ----
      case "confirmPayment": {
        const { paymentReference } = data;
        if (!paymentReference) return res.status(400).json({ success: false, message: "Payment reference required" });
        if (order.payment_status !== "pending") return res.status(400).json({ success: false, message: "Payment already processed" });

        const { data: updatedOrder, error } = await supabase
          .from("orders")
          .update({ payment_status: "paid", payment_reference: paymentReference, escrow_amount: order.total_amount, status: "confirmed", updated_at: new Date().toISOString() })
          .eq("order_id", orderId).select().single();
        if (error) throw error;

        // Create escrow record (8.2% split calculated inside)
        await escrowService.createEscrowForOrder({
          buyerId: order.buyer_id, sellerId: order.seller_id,
          orderId, amount: Number(order.total_amount), buyerEmail: "",
        });

        await supabase.from("escrow_transactions")
          .update({ status: "escrow_held", paid_at: new Date().toISOString(), paystack_reference: paymentReference })
          .eq("order_id", orderId).eq("status", "pending");

        // Track in seller wallet display
        const split = calculateEscrowSplit(Number(order.total_amount));
        await escrowService.holdEscrowInWallet(order.seller_id, split.sellerAmount);

        await supabase.from("order_timeline").insert({ event_id: uuidv4(), order_id: orderId, status: "confirmed", message: "Payment confirmed. Funds held in escrow.", updated_by: userId, created_at: new Date().toISOString() });
        await sendOrderNotification(order.buyer_id, order.order_number, "confirmed", "buyer", { orderId });
        await sendOrderNotification(order.seller_id, order.order_number, "confirmed", "seller", { orderId });

        result = updatedOrder;
        break;
      }

      // ---- RELEASE ESCROW ----
      case "releaseEscrow": {
        if (!["delivered", "completed"].includes(order.status)) return res.status(400).json({ success: false, message: "Order must be delivered before releasing escrow" });
        if (order.payment_status !== "paid") return res.status(400).json({ success: false, message: "Escrow already released or not in escrow" });

        const escrowResult = await escrowService.getEscrowByOrderId(orderId);

        if (!escrowResult.success || !escrowResult.data) {
          // Fallback: no escrow record
          const { data: updatedOrder, error } = await supabase.from("orders")
            .update({ payment_status: "released", escrow_amount: 0, status: "completed", updated_at: new Date().toISOString() })
            .eq("order_id", orderId).select().single();
          if (error) throw error;
          result = updatedOrder;
        } else {
          const releaseResult = await escrowService.releaseFundsToSeller(escrowResult.data.id);
          if (!releaseResult.success) return res.status(400).json({ success: false, message: releaseResult.error || "Failed to release escrow" });

          const { data: updatedOrder } = await supabase.from("orders").select("*").eq("order_id", orderId).single();
          result = updatedOrder;
        }

        await supabase.from("order_timeline").insert({ event_id: uuidv4(), order_id: orderId, status: "completed", message: "Escrow funds released to seller", updated_by: userId, created_at: new Date().toISOString() });
        await sendOrderNotification(order.seller_id, order.order_number, "escrow_released", "seller", { orderId });
        break;
      }

      // ---- ADD TRACKING ----
      case "addTracking": {
        const { trackingNumber, estimatedDelivery } = data;
        if (!trackingNumber) return res.status(400).json({ success: false, message: "Tracking number required" });

        const { data: updatedOrder, error } = await supabase.from("orders")
          .update({ tracking_number: trackingNumber, estimated_delivery: estimatedDelivery || null, status: "shipped", updated_at: new Date().toISOString() })
          .eq("order_id", orderId).select().single();
        if (error) throw error;

        await supabase.from("escrow_transactions").update({ status: "shipped", shipped_at: new Date().toISOString() }).eq("order_id", orderId);
        await supabase.from("order_timeline").insert({ event_id: uuidv4(), order_id: orderId, status: "shipped", message: `Tracking added: ${trackingNumber}`, updated_by: userId, created_at: new Date().toISOString() });
        await sendOrderNotification(order.buyer_id, order.order_number, "shipped", "buyer", { orderId, trackingNumber });

        result = updatedOrder;
        break;
      }

      // ---- RAISE DISPUTE ----
      case "raiseDispute": {
        const { reason, description } = data;
        if (!reason || !description) return res.status(400).json({ success: false, message: "Reason and description required" });

        const { data: existing } = await supabase.from("order_disputes").select("dispute_id").eq("order_id", orderId).maybeSingle();
        if (existing) return res.status(400).json({ success: false, message: "Dispute already exists" });

        await supabase.from("order_disputes").insert({ dispute_id: uuidv4(), order_id: orderId, reason, description, raised_by: isBuyer ? "buyer" : "seller", raised_at: new Date().toISOString() });

        const { data: updatedOrder, error } = await supabase.from("orders").update({ status: "disputed", updated_at: new Date().toISOString() }).eq("order_id", orderId).select().single();
        if (error) throw error;

        await supabase.from("escrow_transactions").update({ status: "disputed", dispute_reason: reason, dispute_opened_at: new Date().toISOString(), auto_release_at: null }).eq("order_id", orderId);
        await supabase.from("order_timeline").insert({ event_id: uuidv4(), order_id: orderId, status: "disputed", message: `Dispute raised: ${reason}`, updated_by: userId, created_at: new Date().toISOString() });
        await sendOrderNotification(order.buyer_id, order.order_number, "disputed", "buyer", { orderId });
        await sendOrderNotification(order.seller_id, order.order_number, "disputed", "seller", { orderId });

        result = updatedOrder;
        break;
      }

      // ---- RESOLVE DISPUTE (admin only) ----
      case "resolveDispute": {
        const { resolution, newStatus, outcome } = data;
        if (!resolution || !newStatus) return res.status(400).json({ success: false, message: "Resolution and new status required" });
        if (order.status !== "disputed") return res.status(400).json({ success: false, message: "No active dispute" });
        if (!isAdmin) return res.status(403).json({ success: false, message: "Only admins can resolve disputes" });

        await supabase.from("order_disputes").update({ resolution, resolved_by: userId, resolved_at: new Date().toISOString() }).eq("order_id", orderId);

        const escrowForDispute = await escrowService.getEscrowByOrderId(orderId);
        if (escrowForDispute.success && escrowForDispute.data) {
          await escrowService.resolveDispute(escrowForDispute.data.id, userId, resolution, outcome || "release_to_seller");
        } else {
          await supabase.from("orders").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("order_id", orderId);
        }

        const { data: updatedOrder } = await supabase.from("orders").select("*").eq("order_id", orderId).single();
        await supabase.from("order_timeline").insert({ event_id: uuidv4(), order_id: orderId, status: newStatus, message: `Dispute resolved by admin: ${resolution}`, updated_by: userId, created_at: new Date().toISOString() });

        await notificationService.createNotification({ user_id: order.buyer_id, title: "Dispute Resolved", message: `Dispute for order ${order.order_number} has been resolved.`, category: "orders", type: "success", action_url: `/orders/${orderId}` });
        await notificationService.createNotification({ user_id: order.seller_id, title: "Dispute Resolved", message: `Dispute for order ${order.order_number} has been resolved.`, category: "orders", type: "success", action_url: `/orders/${orderId}` });

        result = updatedOrder;
        break;
      }

      default:
        return res.status(400).json({ success: false, message: "Invalid action" });
    }

    res.json({ success: true, message: `Order ${action} successful`, data: result });
  } catch (error: any) {
    console.error("Error updating order:", error);
    res.status(500).json({ success: false, message: "Failed to update order" });
  }
});

export default router;