// src/routes/admin/orders.ts
// Admin Order Management Routes
import { Router, Request, Response } from 'express';
import { supabase } from '../../config/supabase';
import { authenticateToken, requireAdmin } from '../../middleware/auth';

const router = Router();

// Apply auth middleware to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// ============================================
// GET /api/admin/orders - List all orders
// ============================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const paymentStatus = req.query.paymentStatus as string;
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' });

    // Filter by status
    if (status && status !== 'all') {
      if (status === 'delivered') {
        query = query.in('status', ['delivered', 'completed']);
      } else if (status === 'overdue') {
        // Orders that are pending/confirmed for more than 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        query = query
          .in('status', ['pending', 'confirmed', 'processing'])
          .lt('created_at', sevenDaysAgo.toISOString());
      } else {
        query = query.eq('status', status);
      }
    }

    // Filter by payment status
    if (paymentStatus && paymentStatus !== 'all') {
      query = query.eq('payment_status', paymentStatus);
    }

    // Search by order number
    if (search) {
      query = query.or(`order_number.ilike.%${search}%`);
    }

    // Apply pagination and ordering
    const { data: orders, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Get buyer and seller info for each order
    const userIds = new Set<string>();
    orders?.forEach(order => {
      if (order.buyer_id) userIds.add(order.buyer_id);
      if (order.seller_id) userIds.add(order.seller_id);
    });

    let usersMap: Record<string, any> = {};
    if (userIds.size > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('user_id, name, email, profile_picture')
        .in('user_id', Array.from(userIds));

      if (users) {
        users.forEach(user => {
          usersMap[user.user_id] = user;
        });
      }
    }

    // Get order items for each order
    const orderIds = orders?.map(o => o.order_id) || [];
    let itemsMap: Record<string, any[]> = {};

    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', orderIds);

      if (items) {
        items.forEach(item => {
          if (!itemsMap[item.order_id]) {
            itemsMap[item.order_id] = [];
          }
          itemsMap[item.order_id].push(item);
        });
      }
    }

    // Transform response
    const transformedOrders = orders?.map(order => {
      const buyer = usersMap[order.buyer_id];
      const seller = usersMap[order.seller_id];
      const orderItems = itemsMap[order.order_id] || [];

      // Parse shipping address
      let shippingAddress = null;
      try {
        shippingAddress = typeof order.shipping_address === 'string' 
          ? JSON.parse(order.shipping_address) 
          : order.shipping_address;
      } catch (e) {
        shippingAddress = null;
      }

      return {
        id: order.order_id,
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        buyer: buyer ? {
          id: order.buyer_id,
          name: buyer.name,
          email: buyer.email,
          avatar: buyer.profile_picture
        } : null,
        seller: seller ? {
          id: order.seller_id,
          name: seller.name,
          email: seller.email,
          avatar: seller.profile_picture
        } : null,
        items: orderItems.map(item => ({
          id: item.item_id,
          productId: item.product_id,
          productName: item.product_name,
          productImage: item.product_image,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          totalPrice: Number(item.total_price)
        })),
        subtotal: Number(order.subtotal) || 0,
        shippingFee: Number(order.shipping_fee) || Number(order.delivery_fee) || 0,
        serviceFee: Number(order.service_fee) || 0,
        taxAmount: Number(order.tax_amount) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        totalAmount: Number(order.total_amount) || 0,
        escrowAmount: Number(order.escrow_amount) || 0,
        currency: order.currency || 'NGN',
        paymentMethod: order.payment_method,
        paymentReference: order.payment_reference,
        deliveryMethod: order.delivery_method,
        shippingAddress: shippingAddress || {
          name: order.delivery_name,
          phone: order.delivery_phone,
          address: order.delivery_address,
          city: order.delivery_city,
          state: order.delivery_state,
          additionalInfo: order.delivery_additional_info
        },
        trackingNumber: order.tracking_number,
        estimatedDelivery: order.estimated_delivery,
        deliveredAt: order.delivered_at || order.actual_delivery,
        notes: order.notes,
        internalNotes: order.internal_notes,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      };
    }) || [];

    res.json({
      success: true,
      data: {
        orders: transformedOrders,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders'
    });
  }
});

// ============================================
// GET /api/admin/orders/stats - Order statistics
// ============================================
router.get('/stats', async (req: Request, res: Response) => {
  try {
    // Get counts for each status
    const [
      allOrdersRes,
      pendingRes,
      confirmedRes,
      shippedRes,
      deliveredRes,
      cancelledRes,
      disputedRes
    ] = await Promise.all([
      supabase.from('orders').select('order_id', { count: 'exact', head: true }),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).in('status', ['confirmed', 'processing']),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'shipped'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).in('status', ['delivered', 'completed']),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'cancelled'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'disputed')
    ]);

    // Calculate overdue (pending/confirmed orders older than 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { count: overdueCount } = await supabase
      .from('orders')
      .select('order_id', { count: 'exact', head: true })
      .in('status', ['pending', 'confirmed', 'processing'])
      .lt('created_at', sevenDaysAgo.toISOString());

    // Get total revenue (completed orders)
    const { data: revenueData } = await supabase
      .from('orders')
      .select('total_amount')
      .in('status', ['delivered', 'completed']);

    const totalRevenue = (revenueData || []).reduce(
      (sum, o) => sum + (Number(o.total_amount) || 0),
      0
    );

    // Get escrow total
    const { data: escrowData } = await supabase
      .from('orders')
      .select('escrow_amount')
      .eq('payment_status', 'paid')
      .in('status', ['confirmed', 'processing', 'shipped']);

    const totalEscrow = (escrowData || []).reduce(
      (sum, o) => sum + (Number(o.escrow_amount) || 0),
      0
    );

    res.json({
      success: true,
      data: {
        all: allOrdersRes.count || 0,
        pending: pendingRes.count || 0,
        confirmed: confirmedRes.count || 0,
        shipped: shippedRes.count || 0,
        delivered: deliveredRes.count || 0,
        cancelled: cancelledRes.count || 0,
        disputed: disputedRes.count || 0,
        overdue: overdueCount || 0,
        totalRevenue,
        totalEscrow
      }
    });
  } catch (error) {
    console.error('Error fetching order stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order statistics'
    });
  }
});

// ============================================
// GET /api/admin/orders/:id - Get single order
// ============================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Get buyer and seller
    const { data: users } = await supabase
      .from('users')
      .select('user_id, name, email, phone_number, profile_picture')
      .in('user_id', [order.buyer_id, order.seller_id].filter(Boolean));

    const usersMap = new Map((users || []).map(u => [u.user_id, u]));
    const buyer = usersMap.get(order.buyer_id);
    const seller = usersMap.get(order.seller_id);

    // Get order items
    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', id);

    // Get timeline
    const { data: timeline } = await supabase
      .from('order_timeline')
      .select('*')
      .eq('order_id', id)
      .order('created_at', { ascending: true });

    // Get dispute if exists
    const { data: dispute } = await supabase
      .from('order_disputes')
      .select('*')
      .eq('order_id', id)
      .maybeSingle();

    // Parse shipping address
    let shippingAddress = null;
    try {
      shippingAddress = typeof order.shipping_address === 'string' 
        ? JSON.parse(order.shipping_address) 
        : order.shipping_address;
    } catch (e) {
      shippingAddress = null;
    }

    res.json({
      success: true,
      data: {
        id: order.order_id,
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        buyer: buyer ? {
          id: order.buyer_id,
          name: buyer.name,
          email: buyer.email,
          phone: buyer.phone_number,
          avatar: buyer.profile_picture
        } : null,
        seller: seller ? {
          id: order.seller_id,
          name: seller.name,
          email: seller.email,
          phone: seller.phone_number,
          avatar: seller.profile_picture
        } : null,
        items: (items || []).map(item => ({
          id: item.item_id,
          productId: item.product_id,
          productName: item.product_name,
          productImage: item.product_image,
          quantity: item.quantity,
          unitPrice: Number(item.unit_price),
          totalPrice: Number(item.total_price)
        })),
        subtotal: Number(order.subtotal) || 0,
        shippingFee: Number(order.shipping_fee) || Number(order.delivery_fee) || 0,
        serviceFee: Number(order.service_fee) || 0,
        taxAmount: Number(order.tax_amount) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        totalAmount: Number(order.total_amount) || 0,
        escrowAmount: Number(order.escrow_amount) || 0,
        currency: order.currency || 'NGN',
        paymentMethod: order.payment_method,
        paymentReference: order.payment_reference,
        deliveryMethod: order.delivery_method,
        shippingAddress: shippingAddress || {
          name: order.delivery_name,
          phone: order.delivery_phone,
          address: order.delivery_address,
          city: order.delivery_city,
          state: order.delivery_state,
          additionalInfo: order.delivery_additional_info
        },
        trackingNumber: order.tracking_number,
        estimatedDelivery: order.estimated_delivery,
        deliveredAt: order.delivered_at || order.actual_delivery,
        paidAt: order.paid_at,
        notes: order.notes,
        internalNotes: order.internal_notes,
        timeline: (timeline || []).map(event => ({
          id: event.event_id,
          status: event.status,
          message: event.message,
          updatedBy: event.updated_by,
          createdAt: event.created_at
        })),
        dispute: dispute ? {
          id: dispute.dispute_id,
          reason: dispute.reason,
          description: dispute.description,
          raisedBy: dispute.raised_by,
          raisedAt: dispute.raised_at,
          resolution: dispute.resolution,
          resolvedBy: dispute.resolved_by,
          resolvedAt: dispute.resolved_at
        } : null,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      }
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order'
    });
  }
});

// ============================================
// PATCH /api/admin/orders/:id/status - Update order status
// ============================================
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, message, internalNotes } = req.body;
    const adminId = (req as any).user?.id;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const allowedStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'disputed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`
      });
    }

    const updates: any = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'delivered') {
      updates.delivered_at = new Date().toISOString();
      updates.actual_delivery = new Date().toISOString();
    }

    if (internalNotes) {
      updates.internal_notes = internalNotes;
    }

    const { data: order, error } = await supabase
      .from('orders')
      .update(updates)
      .eq('order_id', id)
      .select()
      .single();

    if (error) throw error;

    // Add timeline entry
    await supabase.from('order_timeline').insert({
      order_id: id,
      status,
      message: message || `Status changed to ${status} by admin`,
      updated_by: adminId,
      created_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: order
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order status'
    });
  }
});

// ============================================
// POST /api/admin/orders/:id/refund - Process refund
// ============================================
router.post('/:id/refund', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason, amount } = req.body;
    const adminId = (req as any).user?.id;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Refund reason is required'
      });
    }

    // Get the order
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', id)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const refundAmount = amount || order.total_amount;

    // Update order status
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'cancelled',
        payment_status: 'refunded',
        escrow_amount: 0,
        internal_notes: `Refunded ₦${refundAmount} - Reason: ${reason}`,
        updated_at: new Date().toISOString()
      })
      .eq('order_id', id);

    if (updateError) throw updateError;

    // Add timeline entry
    await supabase.from('order_timeline').insert({
      order_id: id,
      status: 'cancelled',
      message: `Refund of ₦${refundAmount.toLocaleString()} processed. Reason: ${reason}`,
      updated_by: adminId,
      created_at: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        orderId: id,
        refundAmount,
        reason
      }
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process refund'
    });
  }
});

// ============================================
// DELETE /api/admin/orders/:id - Delete order
// ============================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Delete order items first
    await supabase
      .from('order_items')
      .delete()
      .eq('order_id', id);

    // Delete timeline
    await supabase
      .from('order_timeline')
      .delete()
      .eq('order_id', id);

    // Delete disputes
    await supabase
      .from('order_disputes')
      .delete()
      .eq('order_id', id);

    // Delete order
    const { error } = await supabase
      .from('orders')
      .delete()
      .eq('order_id', id);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete order'
    });
  }
});

export default router;