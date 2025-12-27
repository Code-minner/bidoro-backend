// backend/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabaseAdmin as supabase } from '../config/database';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: 'buyer' | 'seller' | 'admin';
    seller_type?: 'products' | 'services' | 'both' | null;
    account_status: 'active' | 'suspended' | 'banned' | 'pending';
    kyc_status: 'not_submitted' | 'pending' | 'verified' | 'rejected';
    trust_score: number;
    location?: {
      state?: string;
      city?: string;
      area?: string;
    };
  };
}

export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        user_id, 
        email, 
        name,
        role,
        seller_type,
        account_status,
        kyc_status,
        trust_score,
        location_state,
        location_city,
        location_area
      `)
      .eq('user_id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // Check if account is active
    if (user.account_status !== 'active') {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.account_status}. Please contact support.`
      });
    }

    req.user = {
      id: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role,
      seller_type: user.seller_type,
      account_status: user.account_status,
      kyc_status: user.kyc_status,
      trust_score: parseFloat(user.trust_score) || 0,
      location: {
        state: user.location_state,
        city: user.location_city,
        area: user.location_area
      }
    };
    
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// ✅ NEW: Dedicated middleware for KYC endpoints
export const authenticateForKyc = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const { data: user, error } = await supabase
      .from('users')
      .select(`
        user_id, 
        email, 
        name,
        role,
        seller_type,
        account_status,
        kyc_status,
        trust_score,
        location_state,
        location_city,
        location_area
      `)
      .eq('user_id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // ✅ Allow pending/suspended accounts for KYC (but not banned)
    if (user.account_status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Account is banned. Please contact support.'
      });
    }

    req.user = {
      id: user.user_id,
      email: user.email,
      name: user.name,
      role: user.role,
      seller_type: user.seller_type,
      account_status: user.account_status,
      kyc_status: user.kyc_status,
      trust_score: parseFloat(user.trust_score) || 0,
      location: {
        state: user.location_state,
        city: user.location_city,
        area: user.location_area
      }
    };
    
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const { data: user } = await supabase
      .from('users')
      .select(`
        user_id, 
        email, 
        name,
        role,
        seller_type,
        account_status,
        kyc_status,
        trust_score,
        location_state,
        location_city,
        location_area
      `)
      .eq('user_id', decoded.userId)
      .single();

    if (user && user.account_status === 'active') {
      req.user = {
        id: user.user_id,
        email: user.email,
        name: user.name,
        role: user.role,
        seller_type: user.seller_type,
        account_status: user.account_status,
        kyc_status: user.kyc_status,
        trust_score: parseFloat(user.trust_score) || 0,
        location: {
          state: user.location_state,
          city: user.location_city,
          area: user.location_area
        }
      };
    }
  } catch (error) {
    // Invalid token, but continue without user
  }

  next();
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

export const requireVerifiedSeller = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'seller') {
    return res.status(403).json({
      success: false,
      message: 'Seller account required'
    });
  }

  if (req.user.kyc_status !== 'verified') {
    return res.status(403).json({
      success: false,
      message: 'KYC verification required to perform this action'
    });
  }

  next();
};



export const requireAdmin = requireRole(['admin']);