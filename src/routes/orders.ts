// ================================================
// BIDORO BACKEND - ORDERS API ROUTES
// File: src/routes/orders.ts
// WITH NOTIFICATION INTEGRATION
// ================================================

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { Response } from 'express';
import { notificationService } from '../services/notification.service'; // ADD THIS

const router = Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Service fee percentage (2.5%)
const SERVICE_FEE_PERCENTAGE = 0.025;

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ['active', 'cancelled'],
  pending: ['active', 'cancelled'],
  active: ['completed', 'disputed', 'cancelled'],
  completed: ['disputed'],
  disputed: ['active', 'completed', 'cancelled'],
  cancelled: []
};

// Default status messages
const STATUS_MESSAGES: Record<string, string> = {
  new: 'Order created',
  pending: 'Order pending',
  active: 'Order is being processed',
  completed: 'Order has been completed',
  disputed: 'Dispute has been raised',
  cancelled: 'Order has been cancelled'
};

// ================================================
// HELPER: Generate Order Number
// ================================================
function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BDR-${timestamp}-${random}`;
}

// ================================================
// HELPER: Send order notification
// ================================================
async function sendOrderNotification(
  userId: string,
  orderNumber: string,
  status: string,
  role: 'buyer' | 'seller',
  additionalInfo?: Record<string, any>
) {
  try {
    const notificationTemplates: Record<string, { title: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }> = {
      // Buyer notifications
      'buyer_new': {
        title: 'Order Placed Successfully',
        message: `Your order ${orderNumber} has been placed and is awaiting payment.`,
        type: 'success'
      },
      'buyer_active': {
        title: 'Order Confirmed',
        message: `Your order ${orderNumber} has been confirmed and is being processed.`,
        type: 'success'
      },
      'buyer_shipped': {
        title: 'Order Shipped',
        message: `Your order ${orderNumber} has been shipped! Track your delivery.`,
        type: 'info'
      },
      'buyer_completed': {
        title: 'Order Delivered',
        message: `Your order ${orderNumber} has been delivered. Enjoy your purchase!`,
        type: 'success'
      },
      'buyer_cancelled': {
        title: 'Order Cancelled',
        message: `Your order ${orderNumber} has been cancelled.`,
        type: 'warning'
      },
      'buyer_disputed': {
        title: 'Dispute Raised',
        message: `A dispute has been raised for order ${orderNumber}. We'll resolve it soon.`,
        type: 'warning'
      },
      
      // Seller notifications
      'seller_new': {
        title: 'New Order Received! 🎉',
        message: `You have a new order ${orderNumber}. Review and process it.`,
        type: 'success'
      },
      'seller_active': {
        title: 'Payment Confirmed',
        message: `Payment for order ${orderNumber} is now in escrow. Ship the item.`,
        type: 'success'
      },
      'seller_completed': {
        title: 'Order Completed',
        message: `Order ${orderNumber} has been completed. Funds will be released soon.`,
        type: 'success'
      },
      'seller_cancelled': {
        title: 'Order Cancelled',
        message: `Order ${orderNumber} has been cancelled by the buyer.`,
        type: 'warning'
      },
      'seller_disputed': {
        title: 'Dispute Alert',
        message: `The buyer has raised a dispute for order ${orderNumber}.`,
        type: 'error'
      },
      'seller_escrow_released': {
        title: 'Payment Released! 💰',
        message: `Escrow funds for order ${orderNumber} have been released to your wallet.`,
        type: 'success'
      }
    };

    const key = `${role}_${status}`;
    const template = notificationTemplates[key];

    if (template) {
      await notificationService.createNotification({
        user_id: userId,
        title: template.title,
        message: template.message,
        category: 'orders',
        type: template.type,
        action_url: `/orders/${additionalInfo?.orderId || ''}`,
        metadata: {
          order_number: orderNumber,
          order_status: status,
          ...additionalInfo
        }
      });
    }
  } catch (error) {
    console.error('Failed to send order notification:', error);
  }
}

// ================================================
// GET ALL ORDERS FOR CURRENT USER
// ================================================
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      status,
      view = 'seller',
      page = '1',
      limit = '10',
      sortBy = 'created_at',
      sortOrder = 'desc',
      search
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('orders')
      .select(`
        order_id,
        order_number,
        buyer_id,
        seller_id,
        status,
        payment_status,
        subtotal,
        shipping_fee,
        service_fee,
        tax_amount,
        discount_amount,
        total_amount,
        currency,
        escrow_amount,
        payment_reference,
        payment_method,
        shipping_address,
        billing_address,
        delivery_method,
        tracking_number,
        estimated_delivery,
        delivered_at,
        actual_delivery,
        notes,
        created_at,
        updated_at
      `, { count: 'exact' });

    if (view === 'seller') {
      query = query.eq('seller_id', userId);
    } else {
      query = query.eq('buyer_id', userId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      query = query.ilike('order_number', `%${search}%`);
    }

    const ascending = sortOrder === 'asc';
    query = query.order(sortBy as string, { ascending });
    query = query.range(offset, offset + limitNum - 1);

    const { data: orders, error, count } = await query;

    if (error) throw error;

    const orderIds = orders?.map(o => o.order_id) || [];
    
    let orderItems: any[] = [];
    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', orderIds);
      orderItems = items || [];
    }

    const itemsMap = new Map<string, any[]>();
    orderItems.forEach(item => {
      const items = itemsMap.get(item.order_id) || [];
      items.push(item);
      itemsMap.set(item.order_id, items);
    });

    const participantIds = new Set<string>();
    orders?.forEach(order => {
      participantIds.add(order.buyer_id);
      participantIds.add(order.seller_id);
    });

    let profiles: any[] = [];
    if (participantIds.size > 0) {
      const { data } = await supabase
        .from('users')
        .select('user_id, name, email, profile_picture, phone')
        .in('user_id', Array.from(participantIds));
      profiles = data || [];
    }

    const profileMap = new Map(profiles.map(p => [p.user_id, p]));

    const formattedOrders = orders?.map(order => {
      const buyerProfile = profileMap.get(order.buyer_id);
      const sellerProfile = profileMap.get(order.seller_id);

      return {
        id: order.order_id,
        orderNumber: order.order_number,
        buyer: buyerProfile ? {
          id: order.buyer_id,
          firstName: buyerProfile.name?.split(' ')[0] || '',
          lastName: buyerProfile.name?.split(' ').slice(1).join(' ') || '',
          email: buyerProfile.email,
          phone: buyerProfile.phone,
          avatar: buyerProfile.profile_picture
        } : null,
        seller: sellerProfile ? {
          id: order.seller_id,
          firstName: sellerProfile.name?.split(' ')[0] || '',
          lastName: sellerProfile.name?.split(' ').slice(1).join(' ') || '',
          email: sellerProfile.email,
          avatar: sellerProfile.profile_picture
        } : null,
        items: (itemsMap.get(order.order_id) || []).map(item => ({
          product: item.product_id,
          productName: item.product_name,
          productImage: item.product_image,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          totalPrice: item.total_price
        })),
        shippingInfo: order.shipping_address,
        billingInfo: order.billing_address,
        status: order.status,
        paymentStatus: order.payment_status,
        subtotal: Number(order.subtotal) || 0,
        shippingFee: Number(order.shipping_fee) || 0,
        serviceFee: Number(order.service_fee) || 0,
        taxAmount: Number(order.tax_amount) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        totalAmount: Number(order.total_amount) || 0,
        currency: order.currency || 'NGN',
        escrowAmount: Number(order.escrow_amount) || 0,
        paymentReference: order.payment_reference,
        paymentMethod: order.payment_method,
        deliveryMethod: order.delivery_method,
        trackingNumber: order.tracking_number,
        estimatedDelivery: order.estimated_delivery,
        actualDelivery: order.actual_delivery || order.delivered_at,
        notes: order.notes,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      };
    }) || [];

    const totalPages = Math.ceil((count || 0) / limitNum);

    res.json({
      success: true,
      data: formattedOrders,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      }
    });
  } catch (error: any) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});

// ================================================
// GET ORDER STATISTICS
// ================================================
router.get('/stats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    const [
      totalOrdersRes,
      newOrdersRes,
      activeOrdersRes,
      completedOrdersRes,
      disputedOrdersRes,
      escrowTotalRes,
      currentMonthOrdersRes,
      lastMonthOrdersRes,
      currentMonthRevenueRes,
      lastMonthRevenueRes
    ] = await Promise.all([
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('seller_id', userId),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('seller_id', userId).eq('status', 'new'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('seller_id', userId).eq('status', 'active'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('seller_id', userId).eq('status', 'completed'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('seller_id', userId).eq('status', 'disputed'),
      supabase.from('orders').select('escrow_amount').eq('seller_id', userId).eq('payment_status', 'in_escrow'),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('seller_id', userId).gte('created_at', startOfMonth),
      supabase.from('orders').select('order_id', { count: 'exact', head: true }).eq('seller_id', userId).gte('created_at', startOfLastMonth).lte('created_at', endOfLastMonth),
      supabase.from('orders').select('total_amount').eq('seller_id', userId).eq('status', 'completed').gte('created_at', startOfMonth),
      supabase.from('orders').select('total_amount').eq('seller_id', userId).eq('status', 'completed').gte('created_at', startOfLastMonth).lte('created_at', endOfLastMonth)
    ]);

    const totalOrders = totalOrdersRes.count || 0;
    const newOrders = newOrdersRes.count || 0;
    const activeOrders = activeOrdersRes.count || 0;
    const completedOrders = completedOrdersRes.count || 0;
    const disputedOrders = disputedOrdersRes.count || 0;
    
    const totalEscrowAmount = (escrowTotalRes.data || []).reduce((sum, o) => sum + (Number(o.escrow_amount) || 0), 0);
    const currentMonthOrders = currentMonthOrdersRes.count || 0;
    const lastMonthOrders = lastMonthOrdersRes.count || 0;
    const currentMonthRevenue = (currentMonthRevenueRes.data || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const lastMonthRevenue = (lastMonthRevenueRes.data || []).reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

    const ordersChange = lastMonthOrders > 0
      ? Math.round(((currentMonthOrders - lastMonthOrders) / lastMonthOrders) * 100)
      : 0;

    const revenueChange = lastMonthRevenue > 0
      ? Math.round(((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        raw: {
          totalOrders,
          newOrders,
          activeOrders,
          completedOrders,
          disputedOrders,
          totalEscrowAmount,
          totalRevenue: currentMonthRevenue,
          monthlyComparison: { ordersChange, revenueChange }
        },
        cards: [
          {
            title: 'Amount in Escrow',
            value: `₦ ${totalEscrowAmount.toLocaleString()}`,
            change: `${Math.abs(revenueChange)}% than last month`,
            trend: revenueChange >= 0 ? 'up' : 'down'
          },
          {
            title: 'Pending orders',
            value: String(newOrders + activeOrders),
            change: `${Math.abs(ordersChange)}% than last month`,
            trend: ordersChange >= 0 ? 'up' : 'down'
          },
          {
            title: 'Completed orders',
            value: String(completedOrders),
            change: `${Math.abs(ordersChange)}% than last month`,
            trend: ordersChange >= 0 ? 'up' : 'down'
          },
          {
            title: 'Active products',
            value: String(activeOrders),
            link: 'See all >'
          }
        ]
      }
    });
  } catch (error: any) {
    console.error('Error fetching order stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: error.message
    });
  }
});

// ================================================
// GET SINGLE ORDER BY ID
// ================================================
router.get('/:orderId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const userId = req.user!.id;

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (error || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.buyer_id !== userId && order.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this order'
      });
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);

    const { data: timeline } = await supabase
      .from('order_timeline')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    const { data: dispute } = await supabase
      .from('order_disputes')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();

    const { data: profiles } = await supabase
      .from('users')
      .select('user_id, name, email, profile_picture, phone')
      .in('user_id', [order.buyer_id, order.seller_id]);

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
    const buyerProfile = profileMap.get(order.buyer_id);
    const sellerProfile = profileMap.get(order.seller_id);

    res.json({
      success: true,
      data: {
        id: order.order_id,
        orderNumber: order.order_number,
        buyer: buyerProfile ? {
          id: order.buyer_id,
          firstName: buyerProfile.name?.split(' ')[0] || '',
          lastName: buyerProfile.name?.split(' ').slice(1).join(' ') || '',
          email: buyerProfile.email,
          phone: buyerProfile.phone,
          avatar: buyerProfile.profile_picture
        } : null,
        seller: sellerProfile ? {
          id: order.seller_id,
          firstName: sellerProfile.name?.split(' ')[0] || '',
          lastName: sellerProfile.name?.split(' ').slice(1).join(' ') || '',
          email: sellerProfile.email,
          avatar: sellerProfile.profile_picture
        } : null,
        items: (items || []).map(item => ({
          product: item.product_id,
          productName: item.product_name,
          productImage: item.product_image,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          totalPrice: item.total_price
        })),
        shippingInfo: order.shipping_address,
        billingInfo: order.billing_address,
        status: order.status,
        paymentStatus: order.payment_status,
        subtotal: Number(order.subtotal) || 0,
        shippingFee: Number(order.shipping_fee) || 0,
        serviceFee: Number(order.service_fee) || 0,
        taxAmount: Number(order.tax_amount) || 0,
        discountAmount: Number(order.discount_amount) || 0,
        totalAmount: Number(order.total_amount) || 0,
        currency: order.currency || 'NGN',
        escrowAmount: Number(order.escrow_amount) || 0,
        paymentReference: order.payment_reference,
        paymentMethod: order.payment_method,
        deliveryMethod: order.delivery_method,
        timeline: (timeline || []).map(event => ({
          status: event.status,
          message: event.message,
          timestamp: event.created_at,
          updatedBy: event.updated_by
        })),
        dispute: dispute ? {
          reason: dispute.reason,
          description: dispute.description,
          raisedBy: dispute.raised_by,
          raisedAt: dispute.raised_at,
          resolution: dispute.resolution,
          resolvedAt: dispute.resolved_at
        } : null,
        trackingNumber: order.tracking_number,
        estimatedDelivery: order.estimated_delivery,
        actualDelivery: order.actual_delivery || order.delivered_at,
        notes: order.notes,
        createdAt: order.created_at,
        updatedAt: order.updated_at
      }
    });
  } catch (error: any) {
    console.error('Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order',
      error: error.message
    });
  }
});

// ================================================
// CREATE NEW ORDER - WITH NOTIFICATIONS
// ================================================
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const buyerId = req.user!.id;
    const {
      sellerId,
      items,
      shippingAddress,
      billingAddress,
      paymentMethod = 'flutterwave',
      deliveryMethod = 'standard',
      shippingFee = 0,
      notes
    } = req.body;

    if (!sellerId || !items || !items.length || !shippingAddress) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: sellerId, items, and shippingAddress'
      });
    }

    for (const item of items) {
      if (!item.productId || !item.productName || !item.quantity || !item.unitPrice) {
        return res.status(400).json({
          success: false,
          message: 'Each item must have productId, productName, quantity, and unitPrice'
        });
      }
    }

    const subtotal = items.reduce(
      (sum: number, item: any) => sum + item.quantity * item.unitPrice,
      0
    );
    const serviceFee = Math.round(subtotal * SERVICE_FEE_PERCENTAGE);
    const totalAmount = subtotal + shippingFee + serviceFee;

    const orderId = uuidv4();
    const orderNumber = generateOrderNumber();

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_id: orderId,
        order_number: orderNumber,
        buyer_id: buyerId,
        seller_id: sellerId,
        status: 'new',
        payment_status: 'pending',
        subtotal,
        shipping_fee: shippingFee,
        service_fee: serviceFee,
        tax_amount: 0,
        discount_amount: 0,
        total_amount: totalAmount,
        currency: 'NGN',
        escrow_amount: 0,
        payment_method: paymentMethod,
        shipping_address: shippingAddress,
        billing_address: billingAddress || shippingAddress,
        delivery_method: deliveryMethod,
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (orderError) throw orderError;

    const orderItems = items.map((item: any) => ({
      item_id: uuidv4(),
      order_id: orderId,
      product_id: item.productId,
      product_name: item.productName,
      product_image: item.productImage || null,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.quantity * item.unitPrice,
      created_at: new Date().toISOString()
    }));

    await supabase.from('order_items').insert(orderItems);

    await supabase.from('order_timeline').insert({
      event_id: uuidv4(),
      order_id: orderId,
      status: 'new',
      message: 'Order created and awaiting payment',
      updated_by: buyerId,
      created_at: new Date().toISOString()
    });

    // =============================================
    // SEND NOTIFICATIONS
    // =============================================
    // Notify buyer
    await sendOrderNotification(buyerId, orderNumber, 'new', 'buyer', { 
      orderId, 
      totalAmount 
    });

    // Notify seller
    await sendOrderNotification(sellerId, orderNumber, 'new', 'seller', { 
      orderId, 
      totalAmount,
      itemCount: items.length
    });

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: {
        id: order.order_id,
        orderNumber: order.order_number,
        status: order.status,
        totalAmount: order.total_amount
      }
    });
  } catch (error: any) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  }
});

// ================================================
// UPDATE ORDER - WITH NOTIFICATIONS
// ================================================
router.patch('/:orderId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const userId = req.user!.id;
    const { action, ...data } = req.body;

    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.buyer_id !== userId && order.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this order'
      });
    }

    const isBuyer = order.buyer_id === userId;
    let result;

    switch (action) {
      case 'updateStatus': {
        const { status, message } = data;

        if (!status) {
          return res.status(400).json({
            success: false,
            message: 'Status is required'
          });
        }

        const currentStatus = order.status || 'new';
        if (VALID_TRANSITIONS[currentStatus] && !VALID_TRANSITIONS[currentStatus].includes(status)) {
          return res.status(400).json({
            success: false,
            message: `Invalid status transition from ${currentStatus} to ${status}`
          });
        }

        const updateData: any = {
          status,
          updated_at: new Date().toISOString()
        };

        if (status === 'completed') {
          updateData.delivered_at = new Date().toISOString();
          updateData.actual_delivery = new Date().toISOString();
        }

        const { data: updatedOrder, error } = await supabase
          .from('orders')
          .update(updateData)
          .eq('order_id', orderId)
          .select()
          .single();

        if (error) throw error;

        await supabase.from('order_timeline').insert({
          event_id: uuidv4(),
          order_id: orderId,
          status,
          message: message || STATUS_MESSAGES[status] || `Status changed to ${status}`,
          updated_by: userId,
          created_at: new Date().toISOString()
        });

        // =============================================
        // SEND STATUS UPDATE NOTIFICATIONS
        // =============================================
        // Notify buyer
        await sendOrderNotification(order.buyer_id, order.order_number, status, 'buyer', { orderId });
        
        // Notify seller (if status change was by buyer)
        if (isBuyer) {
          await sendOrderNotification(order.seller_id, order.order_number, status, 'seller', { orderId });
        }

        result = updatedOrder;
        break;
      }

      case 'confirmPayment': {
        const { paymentReference } = data;

        if (!paymentReference) {
          return res.status(400).json({
            success: false,
            message: 'Payment reference is required'
          });
        }

        if (order.payment_status !== 'pending') {
          return res.status(400).json({
            success: false,
            message: 'Payment already processed'
          });
        }

        const { data: updatedOrder, error } = await supabase
          .from('orders')
          .update({
            payment_status: 'in_escrow',
            payment_reference: paymentReference,
            escrow_amount: order.total_amount,
            status: 'active',
            updated_at: new Date().toISOString()
          })
          .eq('order_id', orderId)
          .select()
          .single();

        if (error) throw error;

        await supabase.from('order_timeline').insert({
          event_id: uuidv4(),
          order_id: orderId,
          status: 'active',
          message: 'Payment confirmed. Funds held in escrow.',
          updated_by: userId,
          created_at: new Date().toISOString()
        });

        // =============================================
        // SEND PAYMENT CONFIRMATION NOTIFICATIONS
        // =============================================
        await sendOrderNotification(order.buyer_id, order.order_number, 'active', 'buyer', { orderId });
        await sendOrderNotification(order.seller_id, order.order_number, 'active', 'seller', { orderId });

        result = updatedOrder;
        break;
      }

      case 'releaseEscrow': {
        if (order.status !== 'completed') {
          return res.status(400).json({
            success: false,
            message: 'Order must be completed before releasing escrow'
          });
        }

        if (order.payment_status !== 'in_escrow') {
          return res.status(400).json({
            success: false,
            message: 'Escrow already released or not in escrow'
          });
        }

        const { data: updatedOrder, error } = await supabase
          .from('orders')
          .update({
            payment_status: 'released',
            escrow_amount: 0,
            updated_at: new Date().toISOString()
          })
          .eq('order_id', orderId)
          .select()
          .single();

        if (error) throw error;

        await supabase.from('order_timeline').insert({
          event_id: uuidv4(),
          order_id: orderId,
          status: order.status,
          message: 'Escrow funds released to seller',
          updated_by: userId,
          created_at: new Date().toISOString()
        });

        // =============================================
        // SEND ESCROW RELEASED NOTIFICATION TO SELLER
        // =============================================
        await sendOrderNotification(order.seller_id, order.order_number, 'escrow_released', 'seller', { 
          orderId, 
          amount: order.total_amount 
        });

        result = updatedOrder;
        break;
      }

      case 'addTracking': {
        const { trackingNumber, estimatedDelivery } = data;

        if (!trackingNumber) {
          return res.status(400).json({
            success: false,
            message: 'Tracking number is required'
          });
        }

        const { data: updatedOrder, error } = await supabase
          .from('orders')
          .update({
            tracking_number: trackingNumber,
            estimated_delivery: estimatedDelivery || null,
            updated_at: new Date().toISOString()
          })
          .eq('order_id', orderId)
          .select()
          .single();

        if (error) throw error;

        await supabase.from('order_timeline').insert({
          event_id: uuidv4(),
          order_id: orderId,
          status: order.status,
          message: `Tracking information added: ${trackingNumber}`,
          updated_by: userId,
          created_at: new Date().toISOString()
        });

        // =============================================
        // SEND SHIPPING NOTIFICATION TO BUYER
        // =============================================
        await sendOrderNotification(order.buyer_id, order.order_number, 'shipped', 'buyer', { 
          orderId, 
          trackingNumber 
        });

        result = updatedOrder;
        break;
      }

      case 'raiseDispute': {
        const { reason, description } = data;

        if (!reason || !description) {
          return res.status(400).json({
            success: false,
            message: 'Dispute reason and description are required'
          });
        }

        const { data: existingDispute } = await supabase
          .from('order_disputes')
          .select('dispute_id')
          .eq('order_id', orderId)
          .maybeSingle();

        if (existingDispute) {
          return res.status(400).json({
            success: false,
            message: 'A dispute already exists for this order'
          });
        }

        await supabase.from('order_disputes').insert({
          dispute_id: uuidv4(),
          order_id: orderId,
          reason,
          description,
          raised_by: isBuyer ? 'buyer' : 'seller',
          raised_at: new Date().toISOString()
        });

        const { data: updatedOrder, error } = await supabase
          .from('orders')
          .update({
            status: 'disputed',
            updated_at: new Date().toISOString()
          })
          .eq('order_id', orderId)
          .select()
          .single();

        if (error) throw error;

        await supabase.from('order_timeline').insert({
          event_id: uuidv4(),
          order_id: orderId,
          status: 'disputed',
          message: `Dispute raised by ${isBuyer ? 'buyer' : 'seller'}: ${reason}`,
          updated_by: userId,
          created_at: new Date().toISOString()
        });

        // =============================================
        // SEND DISPUTE NOTIFICATIONS
        // =============================================
        await sendOrderNotification(order.buyer_id, order.order_number, 'disputed', 'buyer', { orderId, reason });
        await sendOrderNotification(order.seller_id, order.order_number, 'disputed', 'seller', { orderId, reason });

        result = updatedOrder;
        break;
      }

      case 'resolveDispute': {
        const { resolution, newStatus } = data;

        if (!resolution || !newStatus) {
          return res.status(400).json({
            success: false,
            message: 'Resolution and new status are required'
          });
        }

        if (order.status !== 'disputed') {
          return res.status(400).json({
            success: false,
            message: 'No active dispute to resolve'
          });
        }

        await supabase
          .from('order_disputes')
          .update({
            resolution,
            resolved_by: userId,
            resolved_at: new Date().toISOString()
          })
          .eq('order_id', orderId);

        const { data: updatedOrder, error } = await supabase
          .from('orders')
          .update({
            status: newStatus,
            updated_at: new Date().toISOString()
          })
          .eq('order_id', orderId)
          .select()
          .single();

        if (error) throw error;

        await supabase.from('order_timeline').insert({
          event_id: uuidv4(),
          order_id: orderId,
          status: newStatus,
          message: `Dispute resolved: ${resolution}`,
          updated_by: userId,
          created_at: new Date().toISOString()
        });

        // Notify both parties of resolution
        await notificationService.createNotification({
          user_id: order.buyer_id,
          title: 'Dispute Resolved',
          message: `The dispute for order ${order.order_number} has been resolved.`,
          category: 'orders',
          type: 'success',
          action_url: `/orders/${orderId}`
        });

        await notificationService.createNotification({
          user_id: order.seller_id,
          title: 'Dispute Resolved',
          message: `The dispute for order ${order.order_number} has been resolved.`,
          category: 'orders',
          type: 'success',
          action_url: `/orders/${orderId}`
        });

        result = updatedOrder;
        break;
      }

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action'
        });
    }

    res.json({
      success: true,
      message: `Order ${action} successful`,
      data: result
    });
  } catch (error: any) {
    console.error('Error updating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order',
      error: error.message
    });
  }
});

export default router;