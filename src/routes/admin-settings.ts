// ================================================
// ADMIN SETTINGS API ROUTES
// File: src/routes/admin-settings.ts
// ================================================

import { Router, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configure multer for logo uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/x-icon', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

// ================================================
// PROFILE SETTINGS
// ================================================

// Get admin profile
router.get('/profile', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data: user, error } = await supabase
      .from('users')
      .select('user_id, name, email, phone_number')
      .eq('user_id', userId)
      .single();

    if (error) throw error;

    // Get avatar from app_settings
    const { data: avatarData } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', `admin_avatar_${userId}`)
      .single();

    const avatarUrl = avatarData?.value?.avatarUrl || null;

    // Split name into first and last
    const nameParts = (user.name || '').split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    res.json({
      success: true,
      data: {
        id: user.user_id,
        firstName,
        lastName,
        email: user.email,
        phoneNumber: user.phone_number || '',
        avatarUrl,
      },
    });
  } catch (error: any) {
    console.error('Error fetching admin profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
      error: error.message,
    });
  }
});

// Update admin profile
router.put('/profile', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { firstName, lastName, email, phoneNumber } = req.body;

    const fullName = `${firstName} ${lastName}`.trim();

    const { data, error } = await supabase
      .from('users')
      .update({
        name: fullName,
        email,
        phone_number: phoneNumber,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data,
    });
  } catch (error: any) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message,
    });
  }
});

// Upload admin avatar
router.post('/profile/avatar', authenticateToken, requireAdmin, upload.single('avatar'), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const fileExt = file.originalname.split('.').pop();
    const fileName = `admin-avatars/${userId}-${uuidv4()}.${fileExt}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploads')
      .getPublicUrl(fileName);

    // Store avatar URL in app_settings (since users table doesn't have avatar_url)
    await supabase
      .from('app_settings')
      .upsert({
        key: `admin_avatar_${userId}`,
        value: { avatarUrl: publicUrl },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      data: { avatarUrl: publicUrl },
    });
  } catch (error: any) {
    console.error('Error uploading avatar:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload avatar',
      error: error.message,
    });
  }
});

// ================================================
// GENERAL SETTINGS (Logos, etc.)
// ================================================

// Get general settings
router.get('/general', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'general_settings')
      .single();

    // Default settings
    const defaultSettings = {
      websiteNavLogo: '/assets/Frame 1.png',
      websiteFooterLogo: '/assets/Frame 2.png',
      dashboardLogo: '/assets/Frame 1.png',
      favicon: '/assets/Frame 3.png',
      siteName: 'Bidoro',
      siteDescription: 'Nigeria\'s premier marketplace',
    };

    res.json({
      success: true,
      data: data?.value || defaultSettings,
    });
  } catch (error: any) {
    console.error('Error fetching general settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch general settings',
      error: error.message,
    });
  }
});

// Update general settings
router.put('/general', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const settings = req.body;

    const { data, error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'general_settings',
        value: {
          ...settings,
          updatedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'General settings updated successfully',
      data: settings,
    });
  } catch (error: any) {
    console.error('Error updating general settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update general settings',
      error: error.message,
    });
  }
});

// Upload logo
router.post('/general/logo', authenticateToken, requireAdmin, upload.single('logo'), async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file;
    const { type } = req.body; // websiteNav, websiteFooter, dashboard, favicon

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    const validTypes = ['websiteNav', 'websiteFooter', 'dashboard', 'favicon'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid logo type',
      });
    }

    const fileExt = file.originalname.split('.').pop();
    const fileName = `logos/${type}-${uuidv4()}.${fileExt}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploads')
      .getPublicUrl(fileName);

    // Update general settings with new logo URL
    const { data: currentSettings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'general_settings')
      .single();

    const logoKey = `${type}Logo`;
    const updatedSettings = {
      ...(currentSettings?.value || {}),
      [logoKey]: publicUrl,
      updatedAt: new Date().toISOString(),
    };

    await supabase
      .from('app_settings')
      .upsert({
        key: 'general_settings',
        value: updatedSettings,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    res.json({
      success: true,
      message: 'Logo uploaded successfully',
      data: { url: publicUrl, type },
    });
  } catch (error: any) {
    console.error('Error uploading logo:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload logo',
      error: error.message,
    });
  }
});

// ================================================
// PAYMENT SETTINGS
// ================================================

// Get payment settings
router.get('/payment', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'payment_settings')
      .single();

    const defaultSettings = {
      activeProvider: 'flutterwave',
      providers: {
        flutterwave: {
          enabled: true,
          currency: 'NGN',
          publicKey: '',
          secretKey: '',
          webhookUrl: '',
        },
        paystack: {
          enabled: false,
          currency: 'NGN',
          publicKey: '',
          secretKey: '',
          webhookUrl: '',
        },
      },
    };

    res.json({
      success: true,
      data: data?.value || defaultSettings,
    });
  } catch (error: any) {
    console.error('Error fetching payment settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment settings',
      error: error.message,
    });
  }
});

// Update payment settings
router.put('/payment', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const settings = req.body;

    const { data, error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'payment_settings',
        value: {
          ...settings,
          updatedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Payment settings updated successfully',
      data: settings,
    });
  } catch (error: any) {
    console.error('Error updating payment settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment settings',
      error: error.message,
    });
  }
});

// Update specific payment provider
router.put('/payment/:provider', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params;
    const providerSettings = req.body;

    const validProviders = ['flutterwave', 'paystack'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment provider',
      });
    }

    // Get current settings
    const { data: currentData } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'payment_settings')
      .single();

    const currentSettings = currentData?.value || {
      activeProvider: 'flutterwave',
      providers: {},
    };

    // Update the specific provider
    const updatedSettings = {
      ...currentSettings,
      providers: {
        ...currentSettings.providers,
        [provider]: {
          ...currentSettings.providers?.[provider],
          ...providerSettings,
        },
      },
      updatedAt: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'payment_settings',
        value: updatedSettings,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    if (error) throw error;

    res.json({
      success: true,
      message: `${provider} settings updated successfully`,
      data: updatedSettings,
    });
  } catch (error: any) {
    console.error('Error updating payment provider:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment provider',
      error: error.message,
    });
  }
});

// Set active payment provider
router.put('/payment/active/:provider', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { provider } = req.params;

    const validProviders = ['flutterwave', 'paystack'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment provider',
      });
    }

    // Get current settings
    const { data: currentData } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'payment_settings')
      .single();

    const currentSettings = currentData?.value || { providers: {} };

    const updatedSettings = {
      ...currentSettings,
      activeProvider: provider,
      updatedAt: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'payment_settings',
        value: updatedSettings,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    if (error) throw error;

    res.json({
      success: true,
      message: `${provider} set as active payment provider`,
      data: updatedSettings,
    });
  } catch (error: any) {
    console.error('Error setting active provider:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set active provider',
      error: error.message,
    });
  }
});

// ================================================
// NOTIFICATION SETTINGS
// ================================================

// Get notification settings
router.get('/notifications', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'notification_settings')
      .single();

    const defaultSettings = {
      bidding: false,
      newSeller: true,
      newOrder: true,
      newMessage: true,
      newProduct: true,
      productApproval: true,
      disputeRaised: true,
      wallet: true,
      webNotification: true,
      emailNotification: true,
      smsNotification: false,
      pushNotification: true,
    };

    res.json({
      success: true,
      data: data?.value || defaultSettings,
    });
  } catch (error: any) {
    console.error('Error fetching notification settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification settings',
      error: error.message,
    });
  }
});

// Update notification settings
router.put('/notifications', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const settings = req.body;

    const { data, error } = await supabase
      .from('app_settings')
      .upsert({
        key: 'notification_settings',
        value: {
          ...settings,
          updatedAt: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      data: settings,
    });
  } catch (error: any) {
    console.error('Error updating notification settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update notification settings',
      error: error.message,
    });
  }
});

export default router;