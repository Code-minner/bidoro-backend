// src/routes/admin/roles.ts
import { Router, Request, Response } from 'express';
import { supabase } from '../../config/supabase';
import { authenticateToken, requireAdmin } from '../../middleware/auth';

const router = Router();

// Apply auth middleware to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// Default permissions list
const DEFAULT_PERMISSIONS = [
  'KYC approval',
  'Edit User',
  'Create Admin',
  'Remove Admins',
  'Create Roles',
  'Suspend Customer',
  'Read Products',
  'Delete Products',
  'Approve Products',
  'Manage Orders',
];

// ============================================
// GET /api/admin/roles - List all roles
// ============================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const { data: roles, error } = await supabase
      .from('admin_roles')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Transform roles
    const transformedRoles = roles?.map(role => ({
      id: role.id,
      title: role.name || role.title,
      permissions: role.permissions || [],
      is_system: role.is_system || false,
      created_at: role.created_at
    })) || [];

    res.json({
      success: true,
      data: {
        roles: transformedRoles
      }
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    
    // Return default roles if table doesn't exist
    res.json({
      success: true,
      data: {
        roles: [
          { id: '1', title: 'Super Admin', permissions: DEFAULT_PERMISSIONS, is_system: true },
          { id: '2', title: 'Admin', permissions: DEFAULT_PERMISSIONS.filter(p => p !== 'Remove Admins'), is_system: true },
          { id: '3', title: 'Content Manager', permissions: ['Read Products', 'Approve Products', 'Delete Products'], is_system: false },
          { id: '4', title: 'Customer Support', permissions: ['Edit User', 'Suspend Customer', 'Read Products'], is_system: false },
          { id: '5', title: 'Compliance', permissions: ['KYC approval', 'Edit User', 'Suspend Customer'], is_system: false },
        ]
      }
    });
  }
});

// ============================================
// GET /api/admin/roles/:id - Get single role
// ============================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: role, error } = await supabase
      .from('admin_roles')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    // Count admins with this role
    const { count } = await supabase
      .from('admin_role_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('role_id', id);

    res.json({
      success: true,
      data: {
        id: role.id,
        title: role.name || role.title,
        permissions: role.permissions || [],
        is_system: role.is_system || false,
        created_at: role.created_at,
        admin_count: count || 0
      }
    });
  } catch (error) {
    console.error('Error fetching role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch role'
    });
  }
});

// ============================================
// POST /api/admin/roles - Create new role
// ============================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, permissions } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Role title is required'
      });
    }

    // Check if role with same name exists
    const { data: existing } = await supabase
      .from('admin_roles')
      .select('id')
      .eq('name', title)
      .single();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A role with this name already exists'
      });
    }

    const { data: role, error } = await supabase
      .from('admin_roles')
      .insert({
        name: title,
        title: title,
        permissions: permissions || [],
        is_system: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Role created successfully',
      data: {
        id: role.id,
        title: role.name,
        permissions: role.permissions,
        is_system: false
      }
    });
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create role'
    });
  }
});

// ============================================
// PUT /api/admin/roles/:id - Update role
// ============================================
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, permissions } = req.body;

    // Check if role exists
    const { data: existing, error: fetchError } = await supabase
      .from('admin_roles')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    // Don't allow changing system role names
    const updates: any = {
      permissions: permissions || existing.permissions
    };

    if (title && !existing.is_system) {
      updates.name = title;
      updates.title = title;
    }

    const { data: role, error } = await supabase
      .from('admin_roles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Role updated successfully',
      data: {
        id: role.id,
        title: role.name || role.title,
        permissions: role.permissions,
        is_system: role.is_system
      }
    });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update role'
    });
  }
});

// ============================================
// DELETE /api/admin/roles/:id - Delete role
// ============================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if role exists and is not a system role
    const { data: role, error: fetchError } = await supabase
      .from('admin_roles')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !role) {
      return res.status(404).json({
        success: false,
        message: 'Role not found'
      });
    }

    if (role.is_system) {
      return res.status(400).json({
        success: false,
        message: 'System roles cannot be deleted'
      });
    }

    // Check if any admins are using this role
    const { count } = await supabase
      .from('admin_role_assignments')
      .select('*', { count: 'exact', head: true })
      .eq('role_id', id);

    if (count && count > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role. ${count} admin(s) are currently assigned to this role.`
      });
    }

    // Delete the role
    const { error } = await supabase
      .from('admin_roles')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Role deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete role'
    });
  }
});

// ============================================
// GET /api/admin/permissions - List all permissions
// ============================================
router.get('/permissions', async (req: Request, res: Response) => {
  try {
    // Check if we have a permissions table
    const { data: permissions, error } = await supabase
      .from('admin_permissions')
      .select('*')
      .order('name', { ascending: true });

    if (error || !permissions || permissions.length === 0) {
      // Return default permissions
      return res.json({
        success: true,
        data: {
          permissions: DEFAULT_PERMISSIONS.map((name, index) => ({
            id: String(index + 1),
            name,
            description: `Permission to ${name.toLowerCase()}`
          }))
        }
      });
    }

    res.json({
      success: true,
      data: {
        permissions: permissions.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    
    // Return default permissions on error
    res.json({
      success: true,
      data: {
        permissions: DEFAULT_PERMISSIONS.map((name, index) => ({
          id: String(index + 1),
          name,
          description: `Permission to ${name.toLowerCase()}`
        }))
      }
    });
  }
});

export default router;