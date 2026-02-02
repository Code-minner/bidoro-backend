// ================================================
// ADMIN DISPUTES API ROUTES
// File: src/routes/admin-disputes.ts
// ================================================

import { Router, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { authenticateToken, AuthRequest, requireAdmin } from '../middleware/auth';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ================================================
// GET ALL DISPUTES
// ================================================
router.get('/', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { 
      page = '1', 
      limit = '10', 
      search = '', 
      status = '',
      type = 'all', // all, appeals, resolved
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from('disputes')
      .select(`
        *,
        order:orders(
          order_id,
          order_number,
          total_amount
        ),
        buyer:users!disputes_buyer_id_fkey(
          user_id,
          name,
          email
        ),
        seller:users!disputes_seller_id_fkey(
          user_id,
          name,
          email
        )
      `, { count: 'exact' });

    // Filter by type/tab
    if (type === 'appeals') {
      query = query.eq('is_appeal', true);
    } else if (type === 'resolved') {
      query = query.eq('status', 'resolved');
    }

    // Status filter
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    // Search filter
    if (search) {
      query = query.or(`ticket_id.ilike.%${search}%,reason.ilike.%${search}%`);
    }

    // Sorting
    query = query.order(sortBy as string, { ascending: sortOrder === 'asc' });

    // Pagination
    query = query.range(offset, offset + limitNum - 1);

    const { data: disputes, error, count } = await query;

    if (error) {
      // If table doesn't exist, return empty
      if (error.code === '42P01') {
        return res.json({
          success: true,
          data: {
            disputes: [],
            pagination: {
              page: pageNum,
              limit: limitNum,
              total: 0,
              totalPages: 0,
            },
          },
        });
      }
      throw error;
    }

    // Format response
    const formattedDisputes = disputes?.map(dispute => ({
      id: dispute.id,
      ticketId: dispute.ticket_id || `DSP-${dispute.id.slice(0, 8).toUpperCase()}`,
      orderId: dispute.order_id,
      orderNumber: dispute.order?.order_number,
      reason: dispute.reason,
      description: dispute.description,
      parties: {
        seller: {
          id: dispute.seller?.user_id,
          name: dispute.seller?.name || 'Unknown Seller',
          email: dispute.seller?.email || '',
        },
        buyer: {
          id: dispute.buyer?.user_id,
          name: dispute.buyer?.name || 'Unknown Buyer',
          email: dispute.buyer?.email || '',
        },
      },
      lastMessage: dispute.last_message || 'No messages yet',
      status: dispute.status || 'open',
      priority: dispute.priority || 'normal',
      isAppeal: dispute.is_appeal || false,
      resolution: dispute.resolution,
      resolvedAt: dispute.resolved_at,
      createdAt: dispute.created_at,
      updatedAt: dispute.updated_at,
    }));

    res.json({
      success: true,
      data: {
        disputes: formattedDisputes || [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limitNum),
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching disputes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch disputes',
      error: error.message,
    });
  }
});

// ================================================
// GET DISPUTE STATISTICS
// ================================================
router.get('/stats', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { data: disputes, error } = await supabase
      .from('disputes')
      .select('status, created_at, resolved_at, priority');

    if (error) {
      // Return zeros if table doesn't exist
      return res.json({
        success: true,
        data: {
          pending: 0,
          inProgress: 0,
          resolvedToday: 0,
          urgent: 0,
          awaitingResponse: 0,
        },
      });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

    // Calculate stats
    const pending = disputes?.filter(d => d.status === 'open' || d.status === 'pending').length || 0;
    const inProgress = disputes?.filter(d => d.status === 'in_progress').length || 0;
    
    const resolvedToday = disputes?.filter(d => {
      if (d.status !== 'resolved' || !d.resolved_at) return false;
      const resolvedDate = new Date(d.resolved_at);
      return resolvedDate >= todayStart;
    }).length || 0;

    const resolvedYesterday = disputes?.filter(d => {
      if (d.status !== 'resolved' || !d.resolved_at) return false;
      const resolvedDate = new Date(d.resolved_at);
      return resolvedDate >= yesterdayStart && resolvedDate < todayStart;
    }).length || 0;

    // Urgent = open for more than 24 hours
    const urgent = disputes?.filter(d => {
      if (d.status !== 'open' && d.status !== 'pending') return false;
      const createdDate = new Date(d.created_at);
      const hoursSinceCreated = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60);
      return hoursSinceCreated > 24;
    }).length || 0;

    // Awaiting response (in progress for more than 12 hours)
    const awaitingResponse = disputes?.filter(d => {
      if (d.status !== 'in_progress') return false;
      // Simplified - just count as awaiting if in progress
      return true;
    }).length || 0;

    // Calculate percentage change
    const percentChange = resolvedYesterday > 0 
      ? Math.round(((resolvedToday - resolvedYesterday) / resolvedYesterday) * 100)
      : resolvedToday > 0 ? 100 : 0;

    res.json({
      success: true,
      data: {
        pending,
        inProgress,
        resolvedToday,
        urgent,
        awaitingResponse,
        percentChange,
      },
    });
  } catch (error: any) {
    console.error('Error fetching dispute stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dispute statistics',
      error: error.message,
    });
  }
});

// ================================================
// GET SINGLE DISPUTE
// ================================================
router.get('/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: dispute, error } = await supabase
      .from('disputes')
      .select(`
        *,
        order:orders(*),
        buyer:users!disputes_buyer_id_fkey(*),
        seller:users!disputes_seller_id_fkey(*),
        messages:dispute_messages(
          *,
          sender:users(user_id, name, email)
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    if (!dispute) {
      return res.status(404).json({
        success: false,
        message: 'Dispute not found',
      });
    }

    res.json({
      success: true,
      data: dispute,
    });
  } catch (error: any) {
    console.error('Error fetching dispute:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dispute',
      error: error.message,
    });
  }
});

// ================================================
// UPDATE DISPUTE STATUS
// ================================================
router.patch('/:id/status', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, resolution } = req.body;

    const validStatuses = ['open', 'pending', 'in_progress', 'resolved', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const updateData: any = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'resolved') {
      updateData.resolved_at = new Date().toISOString();
      updateData.resolved_by = req.user!.id;
      if (resolution) {
        updateData.resolution = resolution;
      }
    }

    const { data, error } = await supabase
      .from('disputes')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: `Dispute ${status === 'resolved' ? 'resolved' : status === 'cancelled' ? 'cancelled' : 'updated'} successfully`,
      data,
    });
  } catch (error: any) {
    console.error('Error updating dispute status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update dispute status',
      error: error.message,
    });
  }
});

// ================================================
// GET DISPUTE MESSAGES
// ================================================
router.get('/:id/messages', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: messages, error } = await supabase
      .from('dispute_messages')
      .select(`
        *,
        sender:users(user_id, name, email, role)
      `)
      .eq('dispute_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      // Return empty if table doesn't exist
      if (error.code === '42P01') {
        return res.json({
          success: true,
          data: [],
        });
      }
      throw error;
    }

    res.json({
      success: true,
      data: messages || [],
    });
  } catch (error: any) {
    console.error('Error fetching dispute messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dispute messages',
      error: error.message,
    });
  }
});

// ================================================
// SEND MESSAGE IN DISPUTE
// ================================================
router.post('/:id/messages', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { message, recipientType } = req.body; // recipientType: 'buyer' | 'seller' | 'both'
    const adminId = req.user!.id;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message cannot be empty',
      });
    }

    // Create message
    const { data: newMessage, error } = await supabase
      .from('dispute_messages')
      .insert({
        dispute_id: id,
        sender_id: adminId,
        message: message.trim(),
        recipient_type: recipientType || 'both',
        is_admin: true,
        created_at: new Date().toISOString(),
      })
      .select(`
        *,
        sender:users(user_id, name, email)
      `)
      .single();

    if (error) throw error;

    // Update dispute last_message
    await supabase
      .from('disputes')
      .update({
        last_message: message.trim().substring(0, 100),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: newMessage,
    });
  } catch (error: any) {
    console.error('Error sending dispute message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message,
    });
  }
});

// ================================================
// RESOLVE DISPUTE
// ================================================
router.post('/:id/resolve', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { resolution, refundBuyer, refundAmount } = req.body;

    const { data, error } = await supabase
      .from('disputes')
      .update({
        status: 'resolved',
        resolution: resolution || 'Resolved by admin',
        resolved_at: new Date().toISOString(),
        resolved_by: req.user!.id,
        refund_buyer: refundBuyer || false,
        refund_amount: refundAmount || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // TODO: If refundBuyer is true, process refund

    res.json({
      success: true,
      message: 'Dispute resolved successfully',
      data,
    });
  } catch (error: any) {
    console.error('Error resolving dispute:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resolve dispute',
      error: error.message,
    });
  }
});

// ================================================
// CANCEL DISPUTE
// ================================================
router.post('/:id/cancel', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data, error } = await supabase
      .from('disputes')
      .update({
        status: 'cancelled',
        resolution: reason || 'Cancelled by admin',
        resolved_at: new Date().toISOString(),
        resolved_by: req.user!.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Dispute cancelled successfully',
      data,
    });
  } catch (error: any) {
    console.error('Error cancelling dispute:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel dispute',
      error: error.message,
    });
  }
});

export default router;