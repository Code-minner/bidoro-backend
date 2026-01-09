// src/routes/wishlist.ts
import express from 'express';
import { supabaseAdmin as supabase } from '../config/supabase';
import { authenticateToken } from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/wishlist
 * Get user's wishlist with full product details
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get wishlist items with product details
    const { data: wishlistItems, error } = await supabase
      .from('wishlists')
      .select(`
        id,
        product_id,
        created_at,
        products (
          product_id,
          name,
          price,
          slug,
          location_city,
          location_state,
          status,
          product_images (
            image_url,
            is_primary
          ),
          categories (
            name
          )
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching wishlist:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch wishlist',
        error: error.message
      });
    }

    // Transform data to match frontend WishlistItem interface
    const formattedItems = wishlistItems?.map(item => {
      const product = item.products as any;
      const primaryImage = product?.product_images?.find((img: any) => img.is_primary) 
        || product?.product_images?.[0];
      
      return {
        product_id: item.product_id,
        name: product?.name || '',
        price: product?.price || 0,
        image_url: primaryImage?.image_url || '/placeholder-product.png',
        slug: product?.slug,
        location_city: product?.location_city,
        location_state: product?.location_state,
        category_name: product?.categories?.name,
        added_at: new Date(item.created_at).getTime(),
        status: product?.status
      };
    }).filter(item => item.status === 'active') || [];

    return res.json({
      success: true,
      data: formattedItems,
      count: formattedItems.length
    });

  } catch (error) {
    console.error('Wishlist fetch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * POST /api/wishlist
 * Add product to wishlist
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { product_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    if (!product_id) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    // Check if product exists
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('product_id, name, status')
      .eq('product_id', product_id)
      .single();

    if (productError || !product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check if already in wishlist
    const { data: existing } = await supabase
      .from('wishlists')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', product_id)
      .single();

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Product already in wishlist'
      });
    }

    // Add to wishlist
    const { data: wishlistItem, error } = await supabase
      .from('wishlists')
      .insert({
        user_id: userId,
        product_id: product_id
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding to wishlist:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to add to wishlist',
        error: error.message
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Added to wishlist',
      data: wishlistItem
    });

  } catch (error) {
    console.error('Wishlist add error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * DELETE /api/wishlist/:productId
 * Remove product from wishlist
 */
router.delete('/:productId', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { productId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { error } = await supabase
      .from('wishlists')
      .delete()
      .eq('user_id', userId)
      .eq('product_id', productId);

    if (error) {
      console.error('Error removing from wishlist:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to remove from wishlist',
        error: error.message
      });
    }

    return res.json({
      success: true,
      message: 'Removed from wishlist'
    });

  } catch (error) {
    console.error('Wishlist remove error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * DELETE /api/wishlist
 * Clear entire wishlist
 */
router.delete('/', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { error } = await supabase
      .from('wishlists')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Error clearing wishlist:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to clear wishlist',
        error: error.message
      });
    }

    return res.json({
      success: true,
      message: 'Wishlist cleared'
    });

  } catch (error) {
    console.error('Wishlist clear error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/wishlist/check/:productId
 * Check if a product is in user's wishlist
 */
router.get('/check/:productId', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { productId } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { data, error } = await supabase
      .from('wishlists')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', productId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('Error checking wishlist:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to check wishlist'
      });
    }

    return res.json({
      success: true,
      inWishlist: !!data
    });

  } catch (error) {
    console.error('Wishlist check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * GET /api/wishlist/count
 * Get wishlist item count
 */
router.get('/count', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const { count, error } = await supabase
      .from('wishlists')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.error('Error getting wishlist count:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get wishlist count'
      });
    }

    return res.json({
      success: true,
      count: count || 0
    });

  } catch (error) {
    console.error('Wishlist count error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;