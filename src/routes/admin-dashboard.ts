// ================================================
// BIDORO BACKEND - ADMIN DASHBOARD API ROUTES
// File: src/routes/admin-dashboard.ts
// ================================================

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { Response } from 'express';

const router = Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Middleware to check if user is admin
const requireAdmin = async (req: AuthRequest, res: Response, next: Function) => {
  try {
    const userId = req.user!.id;
    
    const { data: user, error } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (error || !user || user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to verify admin status'
    });
  }
};

// ================================================
// GET DASHBOARD OVERVIEW STATS
// ================================================
router.get('/stats', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    // Fetch all stats in parallel
    const [
      // Current counts
      totalCustomersRes,
      totalSellersRes,
      totalAdminsRes,
      activeProductsRes,
      
      // Last month counts for comparison
      lastMonthCustomersRes,
      lastMonthSellersRes,
      lastMonthAdminsRes,
      
      // This month new users
      thisMonthCustomersRes,
      thisMonthSellersRes,
    ] = await Promise.all([
      // Total customers (role = 'buyer')
      supabase.from('users').select('user_id', { count: 'exact', head: true }).eq('role', 'buyer'),
      
      // Total sellers (role = 'seller')
      supabase.from('users').select('user_id', { count: 'exact', head: true }).eq('role', 'seller'),
      
      // Total admins (role = 'admin')
      supabase.from('users').select('user_id', { count: 'exact', head: true }).eq('role', 'admin'),
      
      // Active products
      supabase.from('products').select('product_id', { count: 'exact', head: true }).eq('status', 'active'),
      
      // Customers created before this month (for comparison)
      supabase.from('users').select('user_id', { count: 'exact', head: true })
        .eq('role', 'buyer')
        .lt('created_at', startOfMonth),
      
      // Sellers created before this month
      supabase.from('users').select('user_id', { count: 'exact', head: true })
        .eq('role', 'seller')
        .lt('created_at', startOfMonth),
      
      // Admins created before this month
      supabase.from('users').select('user_id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .lt('created_at', startOfMonth),
      
      // Customers created this month
      supabase.from('users').select('user_id', { count: 'exact', head: true })
        .eq('role', 'buyer')
        .gte('created_at', startOfMonth),
      
      // Sellers created this month
      supabase.from('users').select('user_id', { count: 'exact', head: true })
        .eq('role', 'seller')
        .gte('created_at', startOfMonth),
    ]);

    const totalCustomers = totalCustomersRes.count || 0;
    const totalSellers = totalSellersRes.count || 0;
    const totalAdmins = totalAdminsRes.count || 0;
    const activeProducts = activeProductsRes.count || 0;
    
    const lastMonthCustomers = lastMonthCustomersRes.count || 0;
    const lastMonthSellers = lastMonthSellersRes.count || 0;
    const lastMonthAdmins = lastMonthAdminsRes.count || 0;
    
    const thisMonthNewCustomers = thisMonthCustomersRes.count || 0;
    const thisMonthNewSellers = thisMonthSellersRes.count || 0;

    // Calculate percentage changes
    const calculateChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    const customersChange = thisMonthNewCustomers;
    const sellersChange = calculateChange(totalSellers, lastMonthSellers);
    const adminsChange = calculateChange(totalAdmins, lastMonthAdmins);

    res.json({
      success: true,
      data: {
        totalCustomers: {
          value: totalCustomers,
          change: customersChange,
          changeType: customersChange >= 0 ? 'increase' : 'decrease',
          changeText: `${Math.abs(customersChange)} from last month`
        },
        totalSellers: {
          value: totalSellers,
          change: sellersChange,
          changeType: sellersChange >= 0 ? 'increase' : 'decrease',
          changeText: `${Math.abs(sellersChange)}% from last month`
        },
        totalAdmins: {
          value: totalAdmins,
          change: adminsChange,
          changeType: adminsChange >= 0 ? 'increase' : 'decrease',
          changeText: `${Math.abs(adminsChange)}% from last month`
        },
        activeProducts: {
          value: activeProducts
        }
      }
    });
  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard stats',
      error: error.message
    });
  }
});

// ================================================
// GET ORDERS CHART DATA
// ================================================
router.get('/orders-chart', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Get order counts by status
    const [pendingRes, activeRes, completedRes, cancelledRes, disputedRes] = await Promise.all([
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'cancelled'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'disputed'),
    ]);

    const pending = (pendingRes.count || 0) + (activeRes.count || 0); // Combine pending + active as "Pending"
    const completed = completedRes.count || 0;
    const returned = (cancelledRes.count || 0) + (disputedRes.count || 0); // Combine cancelled + disputed as "Returned"
    
    const total = pending + completed + returned;
    
    // Calculate percentages
    const pendingPercent = total > 0 ? Math.round((pending / total) * 100) : 0;
    const completedPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const returnedPercent = total > 0 ? 100 - pendingPercent - completedPercent : 0;

    // Get monthly comparison
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    const [thisMonthRes, lastMonthRes] = await Promise.all([
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).gte('created_at', startOfMonth),
      supabase.from('orders').select('order_id', { count: 'exact', head: true })
        .gte('created_at', startOfLastMonth)
        .lte('created_at', endOfLastMonth),
    ]);

    const thisMonthOrders = thisMonthRes.count || 0;
    const lastMonthOrders = lastMonthRes.count || 0;
    const orderChange = lastMonthOrders > 0 
      ? Math.round(((thisMonthOrders - lastMonthOrders) / lastMonthOrders) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        total,
        change: orderChange,
        changeType: orderChange >= 0 ? 'increase' : 'decrease',
        breakdown: {
          pending: { count: pending, percent: pendingPercent },
          completed: { count: completed, percent: completedPercent },
          returned: { count: returned, percent: returnedPercent }
        }
      }
    });
  } catch (error: any) {
    console.error('Error fetching orders chart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders chart data',
      error: error.message
    });
  }
});

// ================================================
// GET TRANSACTIONS CHART DATA
// ================================================
router.get('/transactions-chart', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    // Get transaction totals by payment status
    const [pendingRes, completedRes] = await Promise.all([
      supabase.from('orders')
        .select('total_amount')
        .in('payment_status', ['pending', 'in_escrow']),
      supabase.from('orders')
        .select('total_amount')
        .eq('payment_status', 'released'),
    ]);

    const pendingAmount = (pendingRes.data || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const completedAmount = (completedRes.data || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const totalAmount = pendingAmount + completedAmount;

    const pendingPercent = totalAmount > 0 ? Math.round((pendingAmount / totalAmount) * 100) : 0;
    const completedPercent = totalAmount > 0 ? 100 - pendingPercent : 0;

    // Get monthly comparison
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    const [thisMonthRes, lastMonthRes] = await Promise.all([
      supabase.from('orders')
        .select('total_amount')
        .gte('created_at', startOfMonth),
      supabase.from('orders')
        .select('total_amount')
        .gte('created_at', startOfLastMonth)
        .lte('created_at', endOfLastMonth),
    ]);

    const thisMonthTotal = (thisMonthRes.data || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const lastMonthTotal = (lastMonthRes.data || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const transactionChange = lastMonthTotal > 0 
      ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal * 100).toFixed(1)
      : '0';

    res.json({
      success: true,
      data: {
        total: totalAmount,
        change: parseFloat(transactionChange),
        changeType: parseFloat(transactionChange) >= 0 ? 'increase' : 'decrease',
        breakdown: {
          pending: { amount: pendingAmount, percent: pendingPercent },
          completed: { amount: completedAmount, percent: completedPercent }
        }
      }
    });
  } catch (error: any) {
    console.error('Error fetching transactions chart:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions chart data',
      error: error.message
    });
  }
});

// ================================================
// GET USER ANALYTICS (Monthly breakdown)
// ================================================
router.get('/user-analytics', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { type = 'customers', year = new Date().getFullYear() } = req.query;
    const role = type === 'sellers' ? 'seller' : 'buyer';
    const yearNum = parseInt(year as string);

    // Get monthly user counts for the specified year
    const monthlyData = [];
    
    for (let month = 0; month < 12; month++) {
      const startOfMonth = new Date(yearNum, month, 1).toISOString();
      const endOfMonth = new Date(yearNum, month + 1, 0, 23, 59, 59).toISOString();
      
      const { count } = await supabase
        .from('users')
        .select('user_id', { count: 'exact', head: true })
        .eq('role', role)
        .gte('created_at', startOfMonth)
        .lte('created_at', endOfMonth);
      
      monthlyData.push({
        month: month + 1,
        monthName: new Date(yearNum, month).toLocaleString('default', { month: 'short' }),
        count: count || 0
      });
    }

    // Calculate total and growth
    const totalThisYear = monthlyData.reduce((sum, m) => sum + m.count, 0);
    
    // Get last year total for comparison
    const lastYearStart = new Date(yearNum - 1, 0, 1).toISOString();
    const lastYearEnd = new Date(yearNum - 1, 11, 31, 23, 59, 59).toISOString();
    
    const { count: lastYearCount } = await supabase
      .from('users')
      .select('user_id', { count: 'exact', head: true })
      .eq('role', role)
      .gte('created_at', lastYearStart)
      .lte('created_at', lastYearEnd);

    const lastYearTotal = lastYearCount || 0;
    const growth = lastYearTotal > 0 
      ? ((totalThisYear - lastYearTotal) / lastYearTotal * 100).toFixed(2)
      : '0';

    // Find peak month
    const peakMonth = monthlyData.reduce((max, m) => m.count > max.count ? m : max, monthlyData[0]);

    res.json({
      success: true,
      data: {
        type: type === 'sellers' ? 'Sellers' : 'Customers',
        year: yearNum,
        total: totalThisYear,
        growth: parseFloat(growth),
        growthType: parseFloat(growth) >= 0 ? 'increase' : 'decrease',
        peakMonth: {
          month: peakMonth.monthName,
          year: yearNum,
          count: peakMonth.count
        },
        monthly: monthlyData
      }
    });
  } catch (error: any) {
    console.error('Error fetching user analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user analytics',
      error: error.message
    });
  }
});

// ================================================
// GET ADMIN INFO (for header)
// ================================================
router.get('/me', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { data: admin, error } = await supabase
      .from('users')
      .select('user_id, name, email, profile_picture, role')
      .eq('user_id', userId)
      .single();

    if (error || !admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: admin.user_id,
        name: admin.name,
        email: admin.email,
        avatar: admin.profile_picture,
        initials: admin.name
          ? admin.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
          : 'AD'
      }
    });
  } catch (error: any) {
    console.error('Error fetching admin info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin info',
      error: error.message
    });
  }
});

export default router;