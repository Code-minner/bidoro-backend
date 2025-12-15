// backend/src/routes/productDrafts.ts
import express from 'express';
import { supabaseAdmin as supabase } from '../config/supabase';
import { authenticateToken, AuthRequest } from '../middleware/auth'; // ✅ Import correct middleware

const router = express.Router();

/**
 * POST /api/products/draft
 * Save product as draft
 */
router.post('/draft', authenticateToken, async (req: AuthRequest, res) => {
  try {
    // ✅ User is already verified by middleware, just use req.user
    const userId = req.user!.id;

    // 2. Get draft data
    const { draftData, draftId } = req.body;

    if (!draftData) {
      return res.status(400).json({
        success: false,
        error: 'Draft data is required'
      });
    }

    // 3. If draftId exists, update existing draft. Otherwise, create new
    if (draftId) {
      // Update existing draft
      const { data, error } = await supabase
        .from('product_drafts')
        .update({
          draft_data: draftData,
          updated_at: new Date().toISOString()
        })
        .eq('draft_id', draftId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error('Draft update error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to update draft'
        });
      }

      return res.json({
        success: true,
        message: 'Draft updated successfully',
        data: {
          draftId: data.draft_id,
          updatedAt: data.updated_at
        }
      });
    } else {
      // Create new draft
      const { data, error } = await supabase
        .from('product_drafts')
        .insert({
          user_id: userId,
          draft_data: draftData
        })
        .select()
        .single();

      if (error) {
        console.error('Draft creation error:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to save draft'
        });
      }

      return res.json({
        success: true,
        message: 'Draft saved successfully',
        data: {
          draftId: data.draft_id,
          createdAt: data.created_at
        }
      });
    }

  } catch (error: any) {
    console.error('❌ Draft save error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save draft',
      message: error.message
    });
  }
});

/**
 * GET /api/products/drafts
 * Get all drafts for current user
 */
router.get('/drafts', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get all drafts
    const { data, error } = await supabase
      .from('product_drafts')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Drafts fetch error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch drafts'
      });
    }

    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0
    });

  } catch (error: any) {
    console.error('❌ Drafts fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch drafts'
    });
  }
});

/**
 * GET /api/products/draft/:id
 * Get single draft by ID
 */
router.get('/draft/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Get draft
    const { data, error } = await supabase
      .from('product_drafts')
      .select('*')
      .eq('draft_id', req.params.id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        error: 'Draft not found'
      });
    }

    res.json({
      success: true,
      data
    });

  } catch (error: any) {
    console.error('❌ Draft fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch draft'
    });
  }
});

/**
 * DELETE /api/products/draft/:id
 * Delete a draft
 */
router.delete('/draft/:id', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;

    // Delete draft
    const { error } = await supabase
      .from('product_drafts')
      .delete()
      .eq('draft_id', req.params.id)
      .eq('user_id', userId);

    if (error) {
      console.error('Draft delete error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete draft'
      });
    }

    res.json({
      success: true,
      message: 'Draft deleted successfully'
    });

  } catch (error: any) {
    console.error('❌ Draft delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete draft'
    });
  }
});

export default router;