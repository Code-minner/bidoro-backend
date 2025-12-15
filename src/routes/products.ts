// src/routes/products.ts
import express from 'express';
import { ProductService } from '../services/productService';
import { authenticateToken, AuthRequest } from '../middleware/auth'; // ✅ Add this
import { supabaseAdmin as supabase } from '../config/supabase';  

const router = express.Router();
const productService = new ProductService();

/**
 * POST /api/products
 * Create a new product
 */
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // ✅ User already verified by middleware
    const userId = req.user!.id;

    // Get form data
    const { productCore, productDetails, additionalInfo, verification } = req.body;

    // Validate
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

    // Create product
    const result = await productService.createProduct({
      sellerId: userId,
      productCore,
      productDetails,
      additionalInfo,
      verification
    });

    // Return success
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

// In backend/src/routes/products.ts - add this endpoint

/**
 * GET /api/products/my-products
 * Get current seller's products
 */
router.get('/my-products', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const sellerId = req.user!.id;

    const { data, error } = await supabase
      .from('products')
      .select(`
        *,
        categories(name, slug),
        product_images(image_url, is_primary)
      `)
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: data || []
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

/**
 * GET /api/products/:id
 * Get single product by ID
 */
router.get('/:id', async (req, res) => {
  try {
    const product = await productService.getProductById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product
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