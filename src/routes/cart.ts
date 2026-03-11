// src/routes/cart.ts

import { Router, Response } from "express";
import { supabaseAdmin as supabase } from "../config/database";
import { authenticateToken, AuthRequest } from "../middleware/auth";

const router = Router();

/**
 * GET /api/cart
 * Get user's cart items with product details
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('cart_items')
      .select(`
        id,
        product_id,
        quantity,
        pay_for_delivery,
        auction_id,
        override_price,
        created_at
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const cartItems = [];
    
    for (const item of data || []) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select(`
          product_id,
          name,
          price,
          seller_id,
          location_state,
          location_city,
          stock_quantity,
          product_images (
            image_url
          )
        `)
        .eq('product_id', item.product_id)
        .single();

      if (productError || !product) continue;

      // Get seller info
      const { data: seller } = await supabase
        .from('users')
        .select('user_id, name, profile_picture')
        .eq('user_id', product.seller_id)
        .single();

      cartItems.push({
        id: item.id,
        productId: product.product_id,
        productName: product.name,
        price: item.override_price || product.price || 0,
        quantity: item.quantity,
        imageUrl: product.product_images?.[0]?.image_url || '/assets/product.png',
        sellerId: product.seller_id,
        sellerName: seller?.name || 'Unknown Seller',
        location: product.location_city 
          ? `${product.location_city}, ${product.location_state}` 
          : product.location_state || '',
        payForDelivery: item.pay_for_delivery,
        stockQuantity: product.stock_quantity || 0,
        auctionId: item.auction_id || null,
        isAuction: !!item.auction_id,
      });
    }

    const subtotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    res.json({
      success: true,
      data: {
        items: cartItems,
        count: cartItems.length,
        subtotal
      }
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart'
    });
  }
});

/**
 * POST /api/cart/add
 * Add item to cart
 */
router.post(
  "/add",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { productId, quantity = 1 } = req.body;

      if (!productId) {
        return res.status(400).json({
          success: false,
          message: "Product ID is required",
        });
      }

      // Check if product exists and is available
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("product_id, seller_id, stock_quantity, status")
        .eq("product_id", productId)
        .single();

      if (productError || !product) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Can't add your own product
      if (product.seller_id === userId) {
        return res.status(400).json({
          success: false,
          message: "You cannot add your own product to cart",
        });
      }

      // Check stock
      if (
        product.stock_quantity !== null &&
        product.stock_quantity < quantity
      ) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock_quantity} items available`,
        });
      }

      // Check if already in cart
      const { data: existing } = await supabase
        .from("cart_items")
        .select("id, quantity")
        .eq("user_id", userId)
        .eq("product_id", productId)
        .single();

      let cartItem;

      if (existing) {
        // Update quantity
        const newQuantity = existing.quantity + quantity;

        // Check stock for new quantity
        if (
          product.stock_quantity !== null &&
          product.stock_quantity < newQuantity
        ) {
          return res.status(400).json({
            success: false,
            message: `Cannot add more. Only ${product.stock_quantity} items available`,
          });
        }

        const { data, error } = await supabase
          .from("cart_items")
          .update({
            quantity: newQuantity,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();

        if (error) throw error;
        cartItem = data;
      } else {
        // Add new item
        const { data, error } = await supabase
          .from("cart_items")
          .insert({
            user_id: userId,
            product_id: productId,
            quantity,
          })
          .select()
          .single();

        if (error) throw error;
        cartItem = data;
      }

      // Get updated cart count
      const { count } = await supabase
        .from("cart_items")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      res.status(201).json({
        success: true,
        message: "Added to cart",
        data: {
          cartItem,
          cartCount: count || 0,
        },
      });
    } catch (error) {
      console.error("Add to cart error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to add to cart",
      });
    }
  },
);

/**
 * PATCH /api/cart/:productId/quantity
 * Update item quantity
 */
router.patch(
  "/:productId/quantity",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { productId } = req.params;
      const { quantity } = req.body;

      if (!quantity || quantity < 1) {
        return res.status(400).json({
          success: false,
          message: "Quantity must be at least 1",
        });
      }

      // Check stock
      const { data: product } = await supabase
        .from("products")
        .select("stock_quantity")
        .eq("product_id", productId)
        .single();

      if (
        product?.stock_quantity !== null &&
        product?.stock_quantity < quantity
      ) {
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock_quantity} items available`,
        });
      }

      const { data, error } = await supabase
        .from("cart_items")
        .update({
          quantity,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("product_id", productId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        message: "Quantity updated",
        data,
      });
    } catch (error) {
      console.error("Update quantity error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update quantity",
      });
    }
  },
);

/**
 * PATCH /api/cart/:productId/delivery
 * Toggle pay for delivery
 */
router.patch(
  "/:productId/delivery",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { productId } = req.params;
      const { payForDelivery } = req.body;

      const { data, error } = await supabase
        .from("cart_items")
        .update({
          pay_for_delivery: payForDelivery,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("product_id", productId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        data,
      });
    } catch (error) {
      console.error("Toggle delivery error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update delivery option",
      });
    }
  },
);

/**
 * DELETE /api/cart/:productId
 * Remove item from cart
 */
router.delete(
  "/:productId",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { productId } = req.params;

      const { error } = await supabase
        .from("cart_items")
        .delete()
        .eq("user_id", userId)
        .eq("product_id", productId);

      if (error) throw error;

      // Get updated cart count
      const { count } = await supabase
        .from("cart_items")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      res.json({
        success: true,
        message: "Removed from cart",
        cartCount: count || 0,
      });
    } catch (error) {
      console.error("Remove from cart error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to remove from cart",
      });
    }
  },
);

/**
 * DELETE /api/cart
 * Clear entire cart
 */
router.delete(
  "/",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      const { error } = await supabase
        .from("cart_items")
        .delete()
        .eq("user_id", userId);

      if (error) throw error;

      res.json({
        success: true,
        message: "Cart cleared",
      });
    } catch (error) {
      console.error("Clear cart error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to clear cart",
      });
    }
  },
);

/**
 * GET /api/cart/count
 * Get cart item count (for header badge)
 */
router.get(
  "/count",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      const { count, error } = await supabase
        .from("cart_items")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      if (error) throw error;

      res.json({
        success: true,
        count: count || 0,
      });
    } catch (error) {
      console.error("Get cart count error:", error);
      res.status(500).json({
        success: false,
        count: 0,
      });
    }
  },
);

export default router;