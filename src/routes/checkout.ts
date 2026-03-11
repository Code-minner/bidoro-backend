// src/routes/checkout.ts

import { Router, Response } from "express";
import { supabaseAdmin as supabase } from "../config/database";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { fincraConfig, fincraAPI } from "../config/fincra";
import { emailService } from "../services/emailService";

const router = Router();

// Default delivery fee
const DEFAULT_DELIVERY_FEE = 2000;

// Helper: Generate order number
const generateOrderNumber = (): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BID-${timestamp}-${random}`;
};

// Helper: Get platform settings
const getPlatformSettings = async () => {
  const { data } = await supabase
    .from("platform_settings")
    .select("key, value");

  const settings: Record<string, string> = {};
  data?.forEach((item) => {
    settings[item.key] = item.value;
  });

  return {
    serviceFeePercent: parseFloat(settings.service_fee_percent || "5"),
    minServiceFee: parseFloat(settings.min_service_fee || "500"),
  };
};

// Helper: Calculate service fee (ROUNDED)
const calculateServiceFee = (
  subtotal: number,
  settings: { serviceFeePercent: number; minServiceFee: number }
) => {
  const percentageFee = (subtotal * settings.serviceFeePercent) / 100;
  return Math.round(Math.max(percentageFee, settings.minServiceFee));
};

/**
 * GET /api/checkout/summary
 */
router.get(
  "/summary",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      const { data: cartItems, error: cartError } = await supabase
        .from("cart_items")
        .select("product_id, quantity, pay_for_delivery")
        .eq("user_id", userId);

      if (cartError) throw cartError;

      if (!cartItems || cartItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Cart is empty",
        });
      }

      let subtotal = 0;
      let deliveryFee = 0;
      const items = [];

      for (const item of cartItems) {
        const { data: product, error: productError } = await supabase
          .from("products")
          .select(`
            product_id, 
            name, 
            price, 
            seller_id,
            product_images (
              image_url
            )
          `)
          .eq("product_id", item.product_id)
          .single();

        if (productError || !product) continue;

        const itemSubtotal = Math.round(product.price * item.quantity);
        const itemDeliveryFee = item.pay_for_delivery ? DEFAULT_DELIVERY_FEE : 0;

        subtotal += itemSubtotal;
        deliveryFee += itemDeliveryFee;

        items.push({
          productId: product.product_id,
          productName: product.name,
          price: product.price,
          quantity: item.quantity,
          subtotal: itemSubtotal,
          imageUrl: product.product_images?.[0]?.image_url || "/assets/product.png",
          sellerId: product.seller_id,
          payForDelivery: item.pay_for_delivery,
          deliveryFee: itemDeliveryFee,
        });
      }

      const settings = await getPlatformSettings();
      const serviceFee = calculateServiceFee(subtotal, settings);
      const totalAmount = Math.round(subtotal + serviceFee + deliveryFee);

      const { data: defaultAddress } = await supabase
        .from("delivery_addresses")
        .select("*")
        .eq("user_id", userId)
        .eq("is_default", true)
        .single();

      res.json({
        success: true,
        data: {
          items,
          subtotal,
          serviceFee,
          deliveryFee,
          totalAmount,
          itemCount: items.length,
          defaultAddress: defaultAddress || null,
        },
      });
    } catch (error) {
      console.error("Get checkout summary error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get checkout summary",
      });
    }
  }
);

/**
 * POST /api/checkout/create-order
 */
router.post(
  "/create-order",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { addressId, paymentMethod = "card" } = req.body;

      const { data: user } = await supabase
        .from("users")
        .select("email, name")
        .eq("user_id", userId)
        .single();

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "User not found",
        });
      }

      let deliveryAddress;
      if (addressId) {
        const { data } = await supabase
          .from("delivery_addresses")
          .select("*")
          .eq("id", addressId)
          .eq("user_id", userId)
          .single();
        deliveryAddress = data;
      } else {
        const { data } = await supabase
          .from("delivery_addresses")
          .select("*")
          .eq("user_id", userId)
          .eq("is_default", true)
          .single();
        deliveryAddress = data;
      }

      if (!deliveryAddress) {
        return res.status(400).json({
          success: false,
          message: "Please add a delivery address",
        });
      }

      const { data: cartItems, error: cartError } = await supabase
        .from("cart_items")
        .select("product_id, quantity, pay_for_delivery")
        .eq("user_id", userId);

      console.log("🛒 Cart items found:", cartItems?.length || 0);

      if (cartError) throw cartError;

      if (!cartItems || cartItems.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Cart is empty",
        });
      }

      let subtotal = 0;
      let deliveryFee = 0;
      const orderItems: any[] = [];
      let firstSellerId: string | null = null;

      for (const item of cartItems) {
        const { data: product, error: productError } = await supabase
          .from("products")
          .select(`
            product_id, 
            name, 
            price, 
            seller_id, 
            stock_quantity,
            product_images (
              image_url
            )
          `)
          .eq("product_id", item.product_id)
          .single();

        if (productError || !product) continue;

        if (!firstSellerId) {
          firstSellerId = product.seller_id;
        }

        if (
          product.stock_quantity !== null &&
          product.stock_quantity < item.quantity
        ) {
          return res.status(400).json({
            success: false,
            message: `${product.name} only has ${product.stock_quantity} items in stock`,
          });
        }

        const itemSubtotal = Math.round(product.price * item.quantity);
        const itemDeliveryFee = item.pay_for_delivery ? DEFAULT_DELIVERY_FEE : 0;

        subtotal += itemSubtotal;
        deliveryFee += itemDeliveryFee;

        orderItems.push({
          product_id: product.product_id,
          seller_id: product.seller_id,
          product_name: product.name,
          product_image: product.product_images?.[0]?.image_url || null,
          unit_price: Math.round(product.price),
          quantity: item.quantity,
          subtotal: itemSubtotal,
          total_price: itemSubtotal,
          pay_for_delivery: item.pay_for_delivery,
          delivery_fee: itemDeliveryFee,
          product_snapshot: {
            product_id: product.product_id,
            name: product.name,
            price: product.price,
            image: product.product_images?.[0]?.image_url || null,
            seller_id: product.seller_id,
          },
        });
      }

      if (orderItems.length === 0 || !firstSellerId) {
        return res.status(400).json({
          success: false,
          message: "No valid items in cart",
        });
      }

      const settings = await getPlatformSettings();
      const serviceFee = calculateServiceFee(subtotal, settings);
      const totalAmount = Math.round(subtotal + serviceFee + deliveryFee);
      const escrowAmount = Math.round(subtotal + deliveryFee);
      const orderNumber = generateOrderNumber();

      console.log(`\n=== CREATING ORDER ${orderNumber} ===`);
      console.log(`Buyer: ${userId}`);
      console.log(`Items: ${orderItems.length}`);
      console.log(`Seller: ${firstSellerId}`);
      console.log(`Subtotal: ₦${subtotal}`);
      console.log(`Service Fee: ₦${serviceFee}`);
      console.log(`Delivery Fee: ₦${deliveryFee}`);
      console.log(`Total: ₦${totalAmount}`);

      const shippingAddress = {
        name: deliveryAddress.name,
        phone: deliveryAddress.phone_number,
        address: deliveryAddress.address,
        city: deliveryAddress.city,
        state: deliveryAddress.state,
        additional_info: deliveryAddress.additional_info || null,
      };

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          order_number: orderNumber,
          buyer_id: userId,
          seller_id: firstSellerId,
          shipping_address: shippingAddress,
          subtotal: Math.round(subtotal),
          total_amount: totalAmount,
          service_fee: serviceFee,
          escrow_amount: escrowAmount,
          shipping_fee: Math.round(deliveryFee),
          delivery_fee: Math.round(deliveryFee),
          tax_amount: 0,
          discount_amount: 0,
          currency: "NGN",
          payment_method: paymentMethod,
          status: "pending",
          payment_status: "pending",
          delivery_name: deliveryAddress.name,
          delivery_phone: deliveryAddress.phone_number,
          delivery_address: deliveryAddress.address,
          delivery_state: deliveryAddress.state,
          delivery_city: deliveryAddress.city,
          delivery_additional_info: deliveryAddress.additional_info,
          delivery_method: deliveryFee > 0 ? "delivery" : "pickup",
        })
        .select()
        .single();

      if (orderError) {
        console.error("Order creation error:", orderError);
        throw orderError;
      }

      console.log(`✅ Order created: ${order.order_id}`);

      const orderItemsWithOrderId = orderItems.map((item) => ({
        ...item,
        order_id: order.order_id,
      }));

      const { error: itemsError } = await supabase
        .from("order_items")
        .insert(orderItemsWithOrderId);

      if (itemsError) {
        console.error("Order items error:", itemsError);
        throw itemsError;
      }

      console.log(`✅ Order items created: ${orderItems.length}`);

      // ================================================
      // FINCRA: Initialize checkout payment
      // Amount is in Naira (no kobo conversion needed)
      // ================================================
      const paymentReference = `ORDER-${orderNumber}-${Date.now()}`;

      const fincraResponse = await fincraAPI.post("/checkout/payments", {
        amount: totalAmount, // Naira — Fincra does NOT use kobo
        currency: "NGN",
        email: user.email,
        name: user.name || user.email,
        reference: paymentReference,
        businessId: fincraConfig.businessId,
        redirectUrl: `${process.env.FRONTEND_URL}/cart/checkout/verify?reference=${paymentReference}`,
        metadata: {
          order_id: order.order_id,
          order_number: orderNumber,
          buyer_id: userId,
        },
      });

      const fincraData = fincraResponse.data;

      if (!fincraData?.data?.link) {
        await supabase.from("orders").delete().eq("order_id", order.order_id);
        throw new Error("Failed to initialize payment");
      }

      await supabase
        .from("orders")
        .update({ payment_reference: paymentReference })
        .eq("order_id", order.order_id);

      console.log(`✅ Fincra payment initialized: ${paymentReference}`);
      console.log(`=== ORDER CREATION COMPLETED ===\n`);

      res.status(201).json({
        success: true,
        message: "Order created successfully",
        data: {
          orderId: order.order_id,
          orderNumber,
          totalAmount,
          paymentUrl: fincraData.data.link,
          reference: paymentReference,
        },
      });
    } catch (error: any) {
      console.error("Create order error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create order",
      });
    }
  }
);

/**
 * GET /api/checkout/verify/:reference
 */
router.get(
  "/verify/:reference",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const { reference } = req.params;
      const userId = req.user!.id;

      console.log(`\n=== VERIFYING PAYMENT ${reference} ===`);

      // ================================================
      // FINCRA: Verify payment by reference
      // ================================================
      const fincraResponse = await fincraAPI.get(
        `/checkout/payments/merchant-reference/${reference}`
      );

      const fincraData = fincraResponse.data;

      if (!fincraData?.data) {
        return res.status(400).json({
          success: false,
          message: "Payment verification failed",
        });
      }

      const { status } = fincraData.data;

      if (status !== "successful") {
        return res.status(400).json({
          success: false,
          message: `Payment ${status}`,
        });
      }

      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("*")
        .eq("payment_reference", reference)
        .eq("buyer_id", userId)
        .single();

      if (orderError || !order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      if (order.payment_status === "paid") {
        return res.json({
          success: true,
          message: "Payment already verified",
          data: {
            orderId: order.order_id,
            orderNumber: order.order_number,
            status: order.status,
          },
        });
      }

      console.log(`✅ Payment verified for order: ${order.order_number}`);

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          payment_status: "paid",
          status: "confirmed",
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("order_id", order.order_id);

      if (updateError) throw updateError;

      const { data: orderItems } = await supabase
        .from("order_items")
        .select("*")
        .eq("order_id", order.order_id);

      // Create escrow transactions for each seller
      const sellerAmounts: Record<string, { amount: number; items: any[] }> = {};

      for (const item of orderItems || []) {
        if (!sellerAmounts[item.seller_id]) {
          sellerAmounts[item.seller_id] = { amount: 0, items: [] };
        }
        sellerAmounts[item.seller_id].amount += item.subtotal + (item.delivery_fee || 0);
        sellerAmounts[item.seller_id].items.push(item);
      }

      for (const [sellerId, data] of Object.entries(sellerAmounts)) {
        const platformFeePercent = 5;
        const platformFee = Math.round((data.amount * platformFeePercent) / 100);
        const sellerAmount = Math.round(data.amount - platformFee);

        const { data: escrow, error: escrowError } = await supabase
          .from("escrow_transactions")
          .insert({
            order_id: order.order_id,
            buyer_id: userId,
            seller_id: sellerId,
            amount: Math.round(data.amount),
            platform_fee: platformFee,
            seller_amount: sellerAmount,
            status: "escrow_held",
            payment_reference: reference,
            auto_release_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select()
          .single();

        if (escrowError) {
          console.error("Escrow creation error:", escrowError);
        } else {
          console.log(`✅ Escrow created for seller ${sellerId}: ₦${sellerAmount}`);

          for (const item of data.items) {
            await supabase
              .from("order_items")
              .update({
                escrow_id: escrow.id,
                item_status: "confirmed",
              })
              .eq("id", item.id);
          }
        }
      }

      // Reduce stock quantities
      for (const item of orderItems || []) {
        await supabase.rpc("decrement_stock", {
          p_product_id: item.product_id,
          p_quantity: item.quantity,
        });
      }

      // Clear user's cart
      await supabase.from("cart_items").delete().eq("user_id", userId);
      console.log(`✅ Cart cleared for user ${userId}`);

      // ============ SEND CONFIRMATION EMAILS ============
      try {
        const { data: buyer } = await supabase
          .from("users")
          .select("email, name")
          .eq("user_id", userId)
          .single();

        if (buyer?.email) {
          await emailService.sendOrderConfirmationEmail({
            name: buyer.name || "Customer",
            email: buyer.email,
            orderNumber: order.order_number,
            totalAmount: order.total_amount,
            items: orderItems || [],
          });
          console.log(`✅ Confirmation email sent to buyer: ${buyer.email}`);
        }

        for (const sellerId of Object.keys(sellerAmounts)) {
          const { data: seller } = await supabase
            .from("users")
            .select("email, name")
            .eq("user_id", sellerId)
            .single();

          if (seller?.email) {
            await emailService.sendNewOrderNotificationEmail({
              name: seller.name || "Seller",
              email: seller.email,
              orderNumber: order.order_number,
              buyerName: buyer?.name || "A customer",
              amount: sellerAmounts[sellerId].amount,
            });
            console.log(`✅ Order notification sent to seller: ${seller.email}`);
          }
        }
      } catch (emailError) {
        console.error("Email sending failed:", emailError);
      }
      // ============ END EMAIL SECTION ============

      console.log(`=== PAYMENT VERIFICATION COMPLETED ===\n`);

      res.json({
        success: true,
        message: "Payment successful! Order confirmed.",
        data: {
          orderId: order.order_id,
          orderNumber: order.order_number,
          status: "confirmed",
        },
      });
    } catch (error: any) {
      console.error("Verify payment error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Payment verification failed",
      });
    }
  }
);

/**
 * GET /api/checkout/order/:orderId
 */
router.get(
  "/order/:orderId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { orderId } = req.params;

      const { data: order, error } = await supabase
        .from("orders")
        .select(`
          *,
          order_items(*)
        `)
        .eq("order_id", orderId)
        .eq("buyer_id", userId)
        .single();

      if (error || !order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      console.error("Get order error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get order",
      });
    }
  }
);

export default router;