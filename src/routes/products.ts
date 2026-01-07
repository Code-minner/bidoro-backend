// src/routes/products.ts
import express from 'express';
import { ProductService } from '../services/productService';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { supabaseAdmin as supabase } from '../config/supabase';  

const router = express.Router();
const productService = new ProductService();

// ============================================================
// IMPORTANT: Specific routes MUST come before parameterized routes!
// ============================================================

/**
 * POST /api/products
 * Create a new product
 */
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    const { productCore, productDetails, additionalInfo, verification } = req.body;

    if (!productCore || !productDetails || !additionalInfo) {
      return res.status(400).json({
        success: false,
        error: 'Missing required data',
        details: {
          productCore: !productCore,
          productDetails: !productDetails,
          additionalInfo: !additionalInfo
        }
      });
    }

    const result = await productService.createProduct({
      sellerId: userId,
      productCore,
      productDetails,
      additionalInfo,
      verification
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully!',
      data: {
        productId: result.product.product_id,
        slug: result.product.slug,
        status: result.product.status,
        verificationRequired: result.product.verification_required
      }
    });

  } catch (error: any) {
    console.error('❌ Product creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create product',
      message: error.message
    });
  }
});

/**
 * GET /api/products/my-products
 * Get current seller's products
 */
router.get('/my-products', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sellerId = req.user!.id;

    // Get products with category info
    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        categories(category_id, name, slug, parent_id),
        product_images(image_url, is_primary)
      `)
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Process products to add parent category as "categories" and current as "subcategory"
    const productsWithHierarchy = await Promise.all(
      (data || []).map(async (product) => {
        const category = product.categories;
        
        // If category has a parent, fetch the parent
        if (category?.parent_id) {
          const { data: parentCat } = await supabase
            .from('categories')
            .select('category_id, name, slug')
            .eq('category_id', category.parent_id)
            .single();
          
          return {
            ...product,
            categories: parentCat || category, // Parent becomes main category
            subcategory: { name: category.name, slug: category.slug } // Current becomes subcategory
          };
        }
        
        // No parent - this IS the main category, no subcategory
        return {
          ...product,
          subcategory: null
        };
      })
    );

    res.json({
      success: true,
      data: productsWithHierarchy
    });

  } catch (error: any) {
    console.error('❌ My products fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products'
    });
  }
});

/**
 * GET /api/products/featured-reels
 * Get products that have video reels for the homepage
 */
router.get('/featured-reels', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 8;

    // Get active products that have videos
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        product_id,
        name,
        slug,
        video_url,
        price,
        seller_id,
        product_images(image_url, is_primary)
      `)
      .not('video_url', 'is', null)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    // Get seller info for each product
    const reelsWithSeller = await Promise.all(
      (products || []).map(async (product) => {
        // Get seller name
        const { data: seller } = await supabase
          .from('users')
          .select('name, profile_picture')
          .eq('user_id', product.seller_id)
          .single();

        // Get primary image as thumbnail
        const primaryImage = product.product_images?.find((img: any) => img.is_primary);
        const thumbnail = primaryImage?.image_url || product.product_images?.[0]?.image_url || null;

        return {
          id: product.product_id,
          product_id: product.product_id,
          name: product.name,
          slug: product.slug,
          video_url: product.video_url,
          thumbnail: thumbnail,
          price: product.price,
          seller: seller ? {
            name: seller.name,
            profile_picture: seller.profile_picture
          } : null
        };
      })
    );

    res.json({
      success: true,
      data: reelsWithSeller
    });

  } catch (error: any) {
    console.error('❌ Featured reels fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch featured reels'
    });
  }
});

/**
 * GET /api/products
 * Get all products with filters
 */
router.get('/', async (req, res) => {
  try {
    const filters = {
      category: req.query.category as string,
      state: req.query.state as string,
      minPrice: req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined,
      maxPrice: req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20
    };

    const result = await productService.getProducts(filters);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });

  } catch (error: any) {
    console.error('❌ Products fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products'
    });
  }
});

// ============================================================
// PARAMETERIZED ROUTES - These must come AFTER specific routes
// Order: /status and /duplicate before generic /:id
// ============================================================

/**
 * PATCH /api/products/:productId/status
 * Update product status (pause, activate, draft)
 */
router.patch('/:productId/status', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { productId } = req.params;
    const { status } = req.body;
    const userId = req.user!.id;

    console.log(`📝 Status update request: Product ${productId} -> ${status} by user ${userId}`);

    // Validate status
    const validStatuses = ['active', 'paused', 'draft'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    // First verify the product belongs to this seller
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('product_id, seller_id, name')
      .eq('product_id', productId)
      .single();

    if (fetchError || !product) {
      console.error('Product not found:', fetchError);
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to update this product'
      });
    }

    // Update the status
    const { data: updatedProduct, error: updateError } = await supabase
      .from('products')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('product_id', productId)
      .select()
      .single();

    if (updateError) {
      console.error('Update product status error:', updateError);
      throw updateError;
    }

    console.log(`✅ Product "${product.name}" status updated to ${status}`);

    res.json({
      success: true,
      data: updatedProduct,
      message: `Product ${status === 'paused' ? 'paused' : status === 'active' ? 'activated' : 'saved as draft'} successfully`
    });

  } catch (error: any) {
    console.error('❌ Update product status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update product status'
    });
  }
});

/**
 * POST /api/products/:productId/duplicate
 * Duplicate a product
 */
router.post('/:productId/duplicate', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user!.id;

    console.log(`📋 Duplicate request: Product ${productId} by user ${userId}`);

    // Fetch the original product with images
    const { data: originalProduct, error: fetchError } = await supabase
      .from('products')
      .select(`
        *,
        product_images (*)
      `)
      .eq('product_id', productId)
      .single();

    if (fetchError || !originalProduct) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (originalProduct.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to duplicate this product'
      });
    }

    // Prepare new product data (remove IDs and timestamps)
    const { 
      product_id, 
      created_at, 
      updated_at, 
      views_count,
      slug,
      product_images,
      ...productData 
    } = originalProduct;

    // Generate new slug
    const newSlug = `${slug}-copy-${Date.now()}`;

    // Create the duplicate product
    const { data: newProduct, error: createError } = await supabase
      .from('products')
      .insert({
        ...productData,
        name: `${productData.name} (Copy)`,
        slug: newSlug,
        status: 'draft',
        views_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) {
      console.error('Duplicate product error:', createError);
      throw createError;
    }

    // Duplicate product images if they exist
    if (product_images && product_images.length > 0) {
      const newImages = product_images.map((img: any) => ({
        product_id: newProduct.product_id,
        image_url: img.image_url,
        is_primary: img.is_primary,
        display_order: img.display_order,
        created_at: new Date().toISOString()
      }));

      const { error: imagesError } = await supabase
        .from('product_images')
        .insert(newImages);

      if (imagesError) {
        console.error('Duplicate images error:', imagesError);
      }
    }

    console.log(`✅ Product duplicated: ${originalProduct.name} -> ${newProduct.name}`);

    res.status(201).json({
      success: true,
      data: newProduct,
      message: 'Product duplicated successfully. It has been saved as a draft.'
    });

  } catch (error: any) {
    console.error('❌ Duplicate product error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to duplicate product'
    });
  }
});

/**
 * DELETE /api/products/:productId
 * Delete a product and all related data (images, reviews, etc.)
 */
router.delete('/:productId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user!.id;

    console.log(`🗑️ Delete request: Product ${productId} by user ${userId}`);

    // First verify the product belongs to this seller
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('product_id, seller_id, name')
      .eq('product_id', productId)
      .single();

    if (fetchError || !product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check ownership
    if (product.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to delete this product'
      });
    }

    // Delete in order to respect foreign key constraints:
    
    // 1. Delete reviews for this product
    const { error: reviewsDeleteError } = await supabase
      .from('reviews')
      .delete()
      .eq('product_id', productId);

    if (reviewsDeleteError) {
      console.error('Delete reviews error:', reviewsDeleteError);
      // Continue anyway
    }

    // 2. Delete product images
    const { error: imagesDeleteError } = await supabase
      .from('product_images')
      .delete()
      .eq('product_id', productId);

    if (imagesDeleteError) {
      console.error('Delete product images error:', imagesDeleteError);
      // Continue anyway
    }

    // 3. Delete from favorites/wishlists if table exists
    try {
      await supabase
        .from('favorites')
        .delete()
        .eq('product_id', productId);
    } catch (e) {
      // Table might not exist
    }

    // 4. Delete from cart_items if table exists
    try {
      await supabase
        .from('cart_items')
        .delete()
        .eq('product_id', productId);
    } catch (e) {
      // Table might not exist
    }

    // 5. Finally delete the product
    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('product_id', productId);

    if (deleteError) {
      console.error('Delete product error:', deleteError);
      throw deleteError;
    }

    console.log(`✅ Product deleted: ${product.name}`);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });

  } catch (error: any) {
    console.error('❌ Delete product error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete product'
    });
  }
});

/**
 * GET /api/products/:id
 * Get single product by ID with seller store info
 * NOTE: This must be LAST among parameterized routes!
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: product, error } = await supabase
      .from('products')
      .select(`
        *,
        categories(category_id, name, slug, parent_id),
        product_images(image_url, is_primary, display_order)
      `)
      .eq('product_id', id)
      .single();

    if (error || !product) {
      console.error('Product query error:', error);
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Process category hierarchy
    let categories = product.categories;
    let subcategory = null;

    if (product.categories?.parent_id) {
      const { data: parentCat } = await supabase
        .from('categories')
        .select('category_id, name, slug')
        .eq('category_id', product.categories.parent_id)
        .single();
      
      if (parentCat) {
        subcategory = { name: product.categories.name, slug: product.categories.slug };
        categories = parentCat;
      }
    }

    // Get seller info separately
    const { data: sellerData } = await supabase
      .from('users')
      .select('user_id, name, profile_picture, trust_score, kyc_status, created_at, location_state, location_city')
      .eq('user_id', product.seller_id)
      .single();

    // Get seller's store name from kyc_applications
    let storeName = null;
    if (product.seller_id) {
      const { data: kycApp } = await supabase
        .from('kyc_applications')
        .select('store_name')
        .eq('user_id', product.seller_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      storeName = kycApp?.store_name || null;
    }

    // Get seller's store logo from kyc_documents
    let storeLogo = null;
    if (product.seller_id) {
      const { data: logoDoc } = await supabase
        .from('kyc_documents')
        .select('file_url')
        .eq('user_id', product.seller_id)
        .eq('document_type', 'store_logo')
        .single();
      
      storeLogo = logoDoc?.file_url || null;
    }

    const seller = sellerData ? {
      ...sellerData,
      store_name: storeName,
      store_logo: storeLogo
    } : null;

    // Increment views
    await supabase
      .from('products')
      .update({ views_count: (product.views_count || 0) + 1 })
      .eq('product_id', id);

    res.json({
      success: true,
      data: {
        ...product,
        categories,
        subcategory,
        seller
      }
    });

  } catch (error: any) {
    console.error('❌ Product fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch product'
    });
  }
});

export default router;