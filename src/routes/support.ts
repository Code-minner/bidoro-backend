// ================================================
// SUPPORT/DISPUTE MESSAGES API ROUTES
// File: src/routes/support.ts
// ================================================

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { Response } from 'express';
import { notificationService } from '../services/notification.service';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

// ================================================
// HELPER: NOTIFY ADMINS
// ================================================
async function notifyAdmins(ticketId: string, ticketNumber: string, messagePreview: string, isImage: boolean = false) {
  try {
    // Get admins from admin_users table
    const { data: adminUsers } = await supabase
      .from('admin_users')
      .select('id, email');

    // Also check users table for role='admin'
    const { data: adminRoleUsers } = await supabase
      .from('users')
      .select('user_id')
      .eq('role', 'admin');

    const adminIds = new Set<string>();
    
    // Add admin_users
    adminUsers?.forEach(admin => adminIds.add(admin.id));
    
    // Add users with admin role
    adminRoleUsers?.forEach(admin => adminIds.add(admin.user_id));

    console.log(`📢 Notifying ${adminIds.size} admins about new support message`);

    for (const adminId of adminIds) {
      await notificationService.createNotification({
        user_id: adminId,
        title: `New Support Message`,
        message: isImage ? '📷 User sent an image' : messagePreview.substring(0, 50) + (messagePreview.length > 50 ? '...' : ''),
        category: 'support',
        type: 'info',
        action_url: `/disputes`,
        metadata: {
          ticket_id: ticketId,
          ticket_number: ticketNumber,
          type: 'support_message'
        }
      });
    }
  } catch (error) {
    console.error('Failed to notify admins:', error);
  }
}

// ================================================
// HELPER: NOTIFY USER
// ================================================
async function notifyUser(userId: string, ticketId: string, ticketNumber: string, messagePreview: string, isImage: boolean = false) {
  try {
    console.log(`📢 Notifying user ${userId} about admin response`);
    
    await notificationService.createNotification({
      user_id: userId,
      title: 'Support Team Replied',
      message: isImage ? '📷 Support sent an image' : messagePreview.substring(0, 50) + (messagePreview.length > 50 ? '...' : ''),
      category: 'support',
      type: 'info',
      action_url: `/support`,
      metadata: {
        ticket_id: ticketId,
        ticket_number: ticketNumber,
        type: 'support_response'
      }
    });
  } catch (error) {
    console.error('Failed to notify user:', error);
  }
}

// ================================================
// GET OR CREATE SUPPORT TICKET FOR USER
// ================================================
router.post('/ticket/get-or-create', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { category, subject, relatedOrderId, relatedProductId } = req.body;

    // Check for existing open ticket
    const { data: existingTicket, error: searchError } = await supabase
      .from('support_tickets')
      .select('ticket_id, ticket_number')
      .eq('user_id', userId)
      .in('status', ['open', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingTicket && !searchError) {
      return res.json({
        success: true,
        data: {
          ticketId: existingTicket.ticket_id,
          ticketNumber: existingTicket.ticket_number,
          isNew: false
        }
      });
    }

    // Create new ticket
    const ticketId = uuidv4();
    const ticketNumber = `SUPPORT-${Date.now()}`;

    const { data: newTicket, error: createError } = await supabase
      .from('support_tickets')
      .insert({
        ticket_id: ticketId,
        ticket_number: ticketNumber,
        user_id: userId,
        category: category || 'general',
        subject: subject || 'Support Request',
        status: 'open',
        priority: 'medium',
        related_order_id: relatedOrderId || null,
        related_product_id: relatedProductId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) throw createError;

    // Notify admins about new ticket
    await notifyAdmins(ticketId, ticketNumber, `New support ticket: ${subject || 'Support Request'}`);

    res.json({
      success: true,
      data: {
        ticketId: newTicket.ticket_id,
        ticketNumber: newTicket.ticket_number,
        isNew: true
      }
    });
  } catch (error: any) {
    console.error('Error creating support ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create support ticket',
      error: error.message
    });
  }
});

// ================================================
// GET SUPPORT MESSAGES FOR TICKET
// ================================================
router.get('/ticket/:ticketId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user!.id;

    // Verify access
    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('user_id')
      .eq('ticket_id', ticketId)
      .single();

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Check if user owns ticket or is admin
    if (ticket.user_id !== userId) {
      const { data: user } = await supabase
        .from('users')
        .select('role')
        .eq('user_id', userId)
        .single();

      const { data: adminUser } = await supabase
        .from('admin_users')
        .select('id')
        .eq('id', userId)
        .single();

      if (!adminUser && user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    // Get messages
    const { data: messages, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Format messages
    const formattedMessages = messages?.map(msg => ({
      id: msg.message_id,
      ticketId: msg.ticket_id,
      senderId: msg.sender_id,
      senderType: msg.sender_type,
      content: msg.content,
      messageType: msg.message_type,
      metadata: msg.metadata,
      imageUrl: msg.metadata?.image_url,
      isRead: msg.is_read,
      createdAt: msg.created_at,
    }));

    res.json({ success: true, data: formattedMessages });
  } catch (error: any) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch messages', error: error.message });
  }
});

// ================================================
// SEND SUPPORT MESSAGE
// ================================================
router.post('/ticket/:ticketId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { content } = req.body;
    const userId = req.user!.id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message content is required' });
    }

    // Get ticket details
    const { data: ticket } = await supabase
      .from('support_tickets')
      .select('user_id, ticket_number, subject')
      .eq('ticket_id', ticketId)
      .single();

    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Determine if sender is admin
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .single();

    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', userId)
      .single();

    const isAdmin = !!adminUser || user?.role === 'admin';
    const senderType = isAdmin ? 'admin' : 'user';

    // Insert message
    const { data: message, error } = await supabase
      .from('support_messages')
      .insert({
        message_id: uuidv4(),
        ticket_id: ticketId,
        sender_id: userId,
        sender_type: senderType,
        content: content.trim(),
        message_type: 'text',
        is_read: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Update ticket
    await supabase
      .from('support_tickets')
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: isAdmin ? 'in_progress' : 'open'
      })
      .eq('ticket_id', ticketId);

    // Send notifications
    if (isAdmin) {
      // Admin sent message - notify user
      await notifyUser(ticket.user_id, ticketId, ticket.ticket_number, content.trim());
    } else {
      // User sent message - notify admins
      await notifyAdmins(ticketId, ticket.ticket_number, content.trim());
    }

    res.json({ success: true, data: message });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, message: 'Failed to send message', error: error.message });
  }
});

// ================================================
// SEND IMAGE MESSAGE
// ================================================
router.post('/ticket/:ticketId/messages/image', 
  authenticateToken, 
  upload.single('image'), 
  async (req: AuthRequest, res: Response) => {
    try {
      const { ticketId } = req.params;
      const { content = '' } = req.body;
      const userId = req.user!.id;

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Image required' });
      }

      // Get ticket
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('user_id, ticket_number')
        .eq('ticket_id', ticketId)
        .single();

      if (!ticket) {
        return res.status(404).json({ success: false, message: 'Ticket not found' });
      }

      // Check if admin
      const { data: adminUser } = await supabase
        .from('admin_users')
        .select('id')
        .eq('id', userId)
        .single();

      const { data: user } = await supabase
        .from('users')
        .select('role')
        .eq('user_id', userId)
        .single();

      const isAdmin = !!adminUser || user?.role === 'admin';
      const senderType = isAdmin ? 'admin' : 'user';

      // Upload to storage
      const fileExt = req.file.originalname.split('.').pop() || 'jpg';
      const fileName = `${uuidv4()}.${fileExt}`;
      const filePath = `support/${ticketId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('uploads')
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('uploads')
        .getPublicUrl(filePath);

      // Insert message
      const { data: message, error } = await supabase
        .from('support_messages')
        .insert({
          message_id: uuidv4(),
          ticket_id: ticketId,
          sender_id: userId,
          sender_type: senderType,
          content: content.trim() || 'Image',
          message_type: 'image',
          metadata: { 
            image_url: publicUrl,
            file_name: req.file.originalname,
            file_size: req.file.size,
            file_type: req.file.mimetype
          },
          is_read: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Update ticket
      await supabase
        .from('support_tickets')
        .update({
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('ticket_id', ticketId);

      // Send notifications
      if (isAdmin) {
        await notifyUser(ticket.user_id, ticketId, ticket.ticket_number, '', true);
      } else {
        await notifyAdmins(ticketId, ticket.ticket_number, '', true);
      }

      res.json({
        success: true,
        data: { ...message, imageUrl: publicUrl }
      });
    } catch (error: any) {
      console.error('Error sending image:', error);
      res.status(500).json({ success: false, message: 'Failed to send image', error: error.message });
    }
});

// ================================================
// GET ALL TICKETS (ADMIN)
// ================================================
router.get('/tickets', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { status, priority } = req.query;

    // Verify admin
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .single();

    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (!adminUser && user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    let query = supabase
      .from('support_tickets')
      .select('*')
      .order('updated_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);

    const { data: tickets, error } = await query;

    if (error) throw error;

    // Get user details
    const userIds = [...new Set(tickets?.map(t => t.user_id) || [])];
    const { data: users } = await supabase
      .from('users')
      .select('user_id, name, email, profile_picture')
      .in('user_id', userIds);

    const userMap = new Map(users?.map(u => [u.user_id, u]) || []);

    const formattedTickets = tickets?.map(ticket => ({
      ...ticket,
      user: userMap.get(ticket.user_id)
    }));

    res.json({ success: true, data: formattedTickets });
  } catch (error: any) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch tickets', error: error.message });
  }
});

// ================================================
// UPDATE TICKET STATUS (ADMIN)
// ================================================
router.patch('/ticket/:ticketId/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { status, priority } = req.body;
    const userId = req.user!.id;

    // Verify admin
    const { data: adminUser } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', userId)
      .single();

    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (!adminUser && user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;

    const { error } = await supabase
      .from('support_tickets')
      .update(updateData)
      .eq('ticket_id', ticketId);

    if (error) throw error;

    // Notify user if ticket resolved/closed
    if (status === 'resolved' || status === 'closed') {
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('user_id, ticket_number')
        .eq('ticket_id', ticketId)
        .single();

      if (ticket) {
        await notificationService.createNotification({
          user_id: ticket.user_id,
          title: status === 'resolved' ? 'Ticket Resolved' : 'Ticket Closed',
          message: `Your support ticket ${ticket.ticket_number} has been ${status}`,
          category: 'support',
          type: 'success',
          action_url: `/support`,
          metadata: { ticket_id: ticketId, ticket_number: ticket.ticket_number }
        });
      }
    }

    res.json({ success: true, message: 'Ticket updated' });
  } catch (error: any) {
    console.error('Error updating ticket:', error);
    res.status(500).json({ success: false, message: 'Failed to update ticket', error: error.message });
  }
});

// ================================================
// MARK SUPPORT NOTIFICATIONS AS READ
// ================================================
router.post('/ticket/:ticketId/mark-read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user!.id;

    // Mark all notifications related to this ticket as read
    // First, get notifications for this user in support category
    const { data: notifications } = await supabase
      .from('notifications')
      .select('id, metadata')
      .eq('user_id', userId)
      .eq('category', 'support')
      .eq('is_read', false);

    // Filter notifications that match this ticket
    const notificationIds = notifications
      ?.filter(n => n.metadata?.ticket_id === ticketId)
      ?.map(n => n.id) || [];

    if (notificationIds.length > 0) {
      await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('id', notificationIds);
    }

    res.json({ success: true, message: 'Notifications marked as read' });
  } catch (error: any) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
  }
});

// ================================================
// MARK ALL SUPPORT NOTIFICATIONS AS READ
// ================================================
router.post('/notifications/mark-read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('category', 'support')
      .eq('is_read', false);

    if (error) throw error;

    res.json({ success: true, message: 'Support notifications marked as read' });
  } catch (error: any) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
  }
});

export default router;