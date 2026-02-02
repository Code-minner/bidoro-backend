// src/routes/admin/admin-users.ts
// Route for managing admin users (from users table where role='admin')
import { Router, Request, Response } from 'express';
import { supabase, supabaseAdmin } from '../../config/supabase';
import { authenticateToken, requireAdmin } from '../../middleware/auth';

const router = Router();

// Apply auth middleware to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// ============================================
// GET /api/admin/admin-users - List all admin users
// ============================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search as string;
    const offset = (page - 1) * limit;

    // Build query - filter by role = 'admin'
    let query = supabase
      .from('users')
      .select('*', { count: 'exact' })
      .eq('role', 'admin');

    // Search filter
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Apply pagination
    const { data: admins, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Transform response
    const transformedAdmins = admins?.map(admin => ({
      id: admin.user_id || admin.id,
      name: admin.name || 'Unknown',
      email: admin.email,
      role: 'Admin',
      status: admin.account_status === 'active' ? 'active' : 'inactive', // lowercase for frontend check
      created_at: admin.created_at,
      last_login: admin.last_active,
      phone_number: admin.phone_number,
      profile_picture: admin.profile_picture
    }));

    res.json({
      success: true,
      data: {
        admins: transformedAdmins || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin users'
    });
  }
});

// ============================================
// GET /api/admin/admin-users/:id - Get single admin user
// ============================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: admin, error } = await supabase
      .from('users')
      .select('*')
      .eq('user_id', id)
      .eq('role', 'admin')
      .single();

    if (error || !admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: admin.user_id || admin.id,
        name: admin.name || 'Unknown',
        email: admin.email,
        phone_number: admin.phone_number,
        role: 'Admin',
        profile_picture: admin.profile_picture,
        status: admin.account_status === 'active' ? 'Active' : 'Inactive',
        created_at: admin.created_at,
        last_login: admin.last_active,
        location_state: admin.location_state,
        location_city: admin.location_city
      }
    });
  } catch (error) {
    console.error('Error fetching admin user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin user'
    });
  }
});

// ============================================
// POST /api/admin/admin-users - Create new admin user
// ============================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, email, phone_number, password } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    // Check if email already exists
    const { data: existing } = await supabase
      .from('users')
      .select('user_id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists'
      });
    }

    // Create user in Supabase Auth (if using auth)
    let authUserId = null;
    if (supabaseAdmin) {
      const tempPassword = password || `Admin${Date.now()}!`;
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { name, role: 'admin' }
      });

      if (authError) {
        console.error('Auth error:', authError);
      } else {
        authUserId = authUser.user?.id;
      }
    }

    // Create admin record in users table
    const { data: admin, error } = await supabase
      .from('users')
      .insert({
        user_id: authUserId || undefined,
        name,
        email,
        phone_number,
        role: 'admin',
        account_status: 'active',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        id: admin.user_id || admin.id,
        name: admin.name,
        email: admin.email,
        role: 'Admin',
        status: 'Active'
      }
    });
  } catch (error) {
    console.error('Error creating admin user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create admin user'
    });
  }
});

// ============================================
// PUT /api/admin/admin-users/:id - Update admin user
// ============================================
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, phone_number, status } = req.body;

    const updates: any = {};
    if (name) updates.name = name;
    if (phone_number !== undefined) updates.phone_number = phone_number;
    if (status) {
      updates.account_status = status.toLowerCase() === 'active' ? 'active' : 'inactive';
    }
    updates.updated_at = new Date().toISOString();

    const { data: admin, error } = await supabase
      .from('users')
      .update(updates)
      .eq('user_id', id)
      .eq('role', 'admin')
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Admin user updated successfully',
      data: {
        id: admin.user_id || admin.id,
        name: admin.name,
        email: admin.email,
        status: admin.account_status === 'active' ? 'Active' : 'Inactive'
      }
    });
  } catch (error) {
    console.error('Error updating admin user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin user'
    });
  }
});

// ============================================
// PATCH /api/admin/admin-users/:id/status - Update status
// ============================================
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'inactive', 'suspended'].includes(status.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (active, inactive, suspended)'
      });
    }

    const accountStatus = status.toLowerCase() === 'active' ? 'active' : 
                          status.toLowerCase() === 'suspended' ? 'suspended' : 'inactive';

    const { data: admin, error } = await supabase
      .from('users')
      .update({ 
        account_status: accountStatus,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', id)
      .eq('role', 'admin')
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: `Admin user ${status === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: admin.user_id,
        status: admin.account_status === 'active' ? 'Active' : 'Inactive'
      }
    });
  } catch (error) {
    console.error('Error updating admin user status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin user status'
    });
  }
});

// ============================================
// DELETE /api/admin/admin-users/:id - Delete/Demote admin user
// ============================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Don't allow deleting yourself
    if (req.user?.id === id || req.user?.user_id === id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    // Soft delete - demote to regular user instead of deleting
    const { error } = await supabase
      .from('users')
      .update({ 
        role: 'user',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', id)
      .eq('role', 'admin');

    if (error) throw error;

    res.json({
      success: true,
      message: 'Admin user removed successfully (demoted to regular user)'
    });
  } catch (error) {
    console.error('Error deleting admin user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete admin user'
    });
  }
});

// ============================================
// POST /api/admin/admin-users/:id/reset-password
// ============================================
router.post('/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get admin email
    const { data: admin, error } = await supabase
      .from('users')
      .select('email')
      .eq('user_id', id)
      .eq('role', 'admin')
      .single();

    if (error || !admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    // Send password reset email via Supabase Auth
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      admin.email,
      { redirectTo: `${process.env.ADMIN_APP_URL || 'http://localhost:3001'}/reset-password` }
    );

    if (resetError) {
      console.error('Reset password error:', resetError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email'
      });
    }

    res.json({
      success: true,
      message: `Password reset email sent to ${admin.email}`
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
});

// ============================================
// POST /api/admin/admin-users/promote/:id - Promote user to admin
// ============================================
router.post('/promote/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: user, error } = await supabase
      .from('users')
      .update({ 
        role: 'admin',
        updated_at: new Date().toISOString()
      })
      .eq('user_id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'User promoted to admin successfully',
      data: {
        id: user.user_id,
        name: user.name,
        email: user.email,
        role: 'Admin'
      }
    });
  } catch (error) {
    console.error('Error promoting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to promote user'
    });
  }
});

export default router;