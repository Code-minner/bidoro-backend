// src/routes/categories.ts
import express from 'express';
import { supabaseAdmin as supabase } from '../config/supabase';

const router = express.Router();

/**
 * GET /api/categories
 * Get all categories as a flat list or hierarchical tree
 * Query params:
 *   - tree=true: Returns nested parent/children structure
 *   - active=true: Only returns active categories (default: true)
 */
router.get('/', async (req, res) => {
  try {
    const asTree = req.query.tree === 'true';
    const activeOnly = req.query.active !== 'false'; // Default to true

    let query = supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data: categories, error } = await query;

    if (error) {
      throw error;
    }

    if (asTree) {
      // Build hierarchical tree
      const tree = buildCategoryTree(categories || []);
      return res.json({
        success: true,
        data: tree,
      });
    }

    // Return flat list
    res.json({
      success: true,
      data: categories || [],
    });

  } catch (error: any) {
    console.error('❌ Categories fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories',
    });
  }
});

/**
 * GET /api/categories/parents
 * Get only parent categories (for homepage, navigation)
 */
router.get('/parents', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

    let query = supabase
      .from('categories')
      .select('*')
      .is('parent_id', null)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (limit) {
      query = query.limit(limit);
    }

    const { data: categories, error } = await query;

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: categories || [],
    });

  } catch (error: any) {
    console.error('❌ Parent categories fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch parent categories',
    });
  }
});

/**
 * GET /api/categories/featured
 * Get featured categories for homepage (first 8 parent categories)
 */
router.get('/featured', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 8;

    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .is('parent_id', null)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .limit(limit);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: categories || [],
    });

  } catch (error: any) {
    console.error('❌ Featured categories fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch featured categories',
    });
  }
});

/**
 * GET /api/categories/:slugOrId
 * Get a single category by slug or ID with its subcategories
 */
router.get('/:slugOrId', async (req, res) => {
  try {
    const { slugOrId } = req.params;

    // Check if it's a UUID or slug
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);

    let query = supabase
      .from('categories')
      .select('*');

    if (isUUID) {
      query = query.eq('category_id', slugOrId);
    } else {
      query = query.eq('slug', slugOrId);
    }

    const { data: category, error } = await query.single();

    if (error || !category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found',
      });
    }

    // Get subcategories if this is a parent
    let subcategories: any[] = [];
    if (!category.parent_id) {
      const { data: subs } = await supabase
        .from('categories')
        .select('*')
        .eq('parent_id', category.category_id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      subcategories = subs || [];
    }

    // Get parent if this is a subcategory
    let parent = null;
    if (category.parent_id) {
      const { data: parentData } = await supabase
        .from('categories')
        .select('*')
        .eq('category_id', category.parent_id)
        .single();

      parent = parentData;
    }

    res.json({
      success: true,
      data: {
        ...category,
        subcategories,
        parent,
      },
    });

  } catch (error: any) {
    console.error('❌ Category fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category',
    });
  }
});

/**
 * GET /api/categories/:parentSlug/subcategories
 * Get subcategories for a parent category
 */
router.get('/:parentSlug/subcategories', async (req, res) => {
  try {
    const { parentSlug } = req.params;

    // First get the parent
    const { data: parent, error: parentError } = await supabase
      .from('categories')
      .select('category_id')
      .eq('slug', parentSlug)
      .is('parent_id', null)
      .single();

    if (parentError || !parent) {
      return res.status(404).json({
        success: false,
        error: 'Parent category not found',
      });
    }

    // Get subcategories
    const { data: subcategories, error } = await supabase
      .from('categories')
      .select('*')
      .eq('parent_id', parent.category_id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: subcategories || [],
    });

  } catch (error: any) {
    console.error('❌ Subcategories fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subcategories',
    });
  }
});

/**
 * Helper: Build category tree from flat list
 */
function buildCategoryTree(categories: any[]) {
  const categoryMap = new Map();
  const tree: any[] = [];

  // First pass: create map of all categories
  categories.forEach(cat => {
    categoryMap.set(cat.category_id, { ...cat, subcategories: [] });
  });

  // Second pass: build tree structure
  categories.forEach(cat => {
    const node = categoryMap.get(cat.category_id);
    if (cat.parent_id) {
      const parent = categoryMap.get(cat.parent_id);
      if (parent) {
        parent.subcategories.push(node);
      }
    } else {
      tree.push(node);
    }
  });

  return tree;
}

export default router;