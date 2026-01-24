import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { hashPassword, comparePassword, generateToken } from '../utils/helpers';
import { RegisterRequest, LoginRequest } from '../types';
import { AuthRequest as AuthenticatedRequest } from '../middleware/auth';
import { onUserSignup } from '../utils/referral.utils';
import { notificationService } from '../services/notification.service'; // ADD THIS

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      name, 
      email, 
      password, 
      role = 'buyer', 
      phone_number, 
      location,
      referral_code
    }: RegisterRequest & { referral_code?: string } = req.body;

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
      return;
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([
        {
          name: name.trim(),
          email: email.toLowerCase(),
          password: hashedPassword,
          role,
          phone_number,
          location,
          kyc_status: 'pending',
          trust_score: 0.00,
          account_status: 'active'
        }
      ])
      .select('user_id, name, email, role, phone_number, location, kyc_status, trust_score, account_status, referral_code, total_points, created_at, updated_at')
      .single();

    if (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create user account'
      });
      return;
    }

    // =============================================
    // SEND WELCOME NOTIFICATION
    // =============================================
    try {
      await notificationService.createWelcomeNotification(newUser.user_id, newUser.name);
    } catch (notifError) {
      console.error('Failed to create welcome notification:', notifError);
      // Don't fail registration if notification fails
    }

    // Apply referral code if provided
    let referralBonus: number | undefined;
    if (referral_code) {
      const referralResult = await onUserSignup(newUser.user_id, referral_code);
      referralBonus = referralResult.pointsEarned;
      
      // Referral notification is already sent in onUserSignup via referral.utils.ts
    }

    // Generate JWT token
    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: referralBonus 
        ? `User registered successfully! You earned ${referralBonus} bonus points!`
        : 'User registered successfully',
      data: {
        user: newUser,
        token,
        referral_bonus: referralBonus
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password }: LoginRequest = req.body;

    // Find user by email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
      return;
    }

    // Check account status
    if (user.account_status !== 'active') {
      res.status(401).json({
        success: false,
        message: 'Account is suspended or banned'
      });
      return;
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
      return;
    }

    // Update last active
    await supabase
      .from('users')
      .update({ last_active: new Date().toISOString() })
      .eq('user_id', user.user_id);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    // Generate JWT token
    const token = generateToken(userWithoutPassword);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        token
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('user_id, name, email, role, phone_number, location, profile_picture, kyc_status, trust_score, account_status, referral_code, total_points, redeemable_points, referral_count, created_at, updated_at')
      .eq('user_id', req.user!.id)
      .single();

    if (error || !user) {
      res.status(404).json({
        success: false,
        message: 'User not found'
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { user }
    });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { name, phone_number, location, profile_picture } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name.trim();
    if (phone_number) updateData.phone_number = phone_number;
    if (location) updateData.location = location;
    if (profile_picture) updateData.profile_picture = profile_picture;

    updateData.updated_at = new Date().toISOString();

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('user_id', req.user!.id)
      .select('user_id, name, email, role, phone_number, location, profile_picture, kyc_status, trust_score, account_status, referral_code, total_points, redeemable_points, created_at, updated_at')
      .single();

    if (error) {
      console.error('Update profile error:', error);
      res.status(400).json({
        success: false,
        message: 'Failed to update profile'
      });
      return;
    }

    // =============================================
    // SEND PROFILE UPDATE NOTIFICATION
    // =============================================
    try {
      await notificationService.createAccountNotification(
        req.user!.id,
        'Profile Updated',
        'Your profile has been updated successfully.',
        'success'
      );
    } catch (notifError) {
      console.error('Failed to create profile update notification:', notifError);
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: updatedUser }
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Update last active time
    await supabase
      .from('users')
      .update({ last_active: new Date().toISOString() })
      .eq('user_id', req.user!.id);

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};