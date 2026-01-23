// src/routes/deliveryAddress.ts

import { Router, Response } from 'express';
import { supabaseAdmin as supabase } from '../config/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * GET /api/user/addresses
 * Get all delivery addresses for user
 */
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('delivery_addresses')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch addresses'
    });
  }
});

/**
 * GET /api/user/addresses/default
 * Get user's default address
 */
router.get('/default', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('delivery_addresses')
      .select('*')
      .eq('user_id', userId)
      .eq('is_default', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      success: true,
      data: data || null
    });
  } catch (error) {
    console.error('Get default address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch default address'
    });
  }
});

/**
 * POST /api/user/addresses
 * Add new delivery address
 */
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, phoneNumber, address, additionalInfo, state, city, isDefault } = req.body;

    // Validation
    if (!name || !phoneNumber || !address || !state || !city) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone number, address, state, and city are required'
      });
    }

    // If this is set as default, unset other defaults
    if (isDefault) {
      await supabase
        .from('delivery_addresses')
        .update({ is_default: false })
        .eq('user_id', userId);
    }

    // Check if this is the first address (make it default)
    const { count } = await supabase
      .from('delivery_addresses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const shouldBeDefault = isDefault || count === 0;

    const { data, error } = await supabase
      .from('delivery_addresses')
      .insert({
        user_id: userId,
        name,
        phone_number: phoneNumber,
        address,
        additional_info: additionalInfo || null,
        state,
        city,
        is_default: shouldBeDefault
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data
    });
  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add address'
    });
  }
});

/**
 * PUT /api/user/addresses/:id
 * Update delivery address
 */
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { name, phoneNumber, address, additionalInfo, state, city, isDefault } = req.body;

    // Verify ownership
    const { data: existing } = await supabase
      .from('delivery_addresses')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Address not found'
      });
    }

    // If setting as default, unset others
    if (isDefault) {
      await supabase
        .from('delivery_addresses')
        .update({ is_default: false })
        .eq('user_id', userId);
    }

    const { data, error } = await supabase
      .from('delivery_addresses')
      .update({
        name,
        phone_number: phoneNumber,
        address,
        additional_info: additionalInfo,
        state,
        city,
        is_default: isDefault,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Address updated successfully',
      data
    });
  } catch (error) {
    console.error('Update address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update address'
    });
  }
});

/**
 * DELETE /api/user/addresses/:id
 * Delete delivery address
 */
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const { error } = await supabase
      .from('delivery_addresses')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
  } catch (error) {
    console.error('Delete address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete address'
    });
  }
});

/**
 * PATCH /api/user/addresses/:id/default
 * Set address as default
 */
router.patch('/:id/default', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    // Unset all defaults
    await supabase
      .from('delivery_addresses')
      .update({ is_default: false })
      .eq('user_id', userId);

    // Set this one as default
    const { data, error } = await supabase
      .from('delivery_addresses')
      .update({ is_default: true })
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Default address updated',
      data
    });
  } catch (error) {
    console.error('Set default address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set default address'
    });
  }
});

export default router;