// ================================================
// BIDORO BACKEND - MESSAGES API ROUTES
// File: src/routes/messages.ts
// ================================================

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { Response } from 'express';

const router = Router();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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
// GET ALL CONVERSATIONS FOR CURRENT USER
// ================================================
router.get('/conversations', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Get conversations where user is buyer or seller
    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        conversation_id,
        buyer_id,
        seller_id,
        product_id,
        order_id,
        status,
        last_message_at,
        last_message_preview,
        unread_count_buyer,
        unread_count_seller,
        created_at,
        updated_at
      `)
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get user profiles for all participants
    const participantIds = new Set<string>();
    conversations?.forEach(conv => {
      participantIds.add(conv.buyer_id);
      participantIds.add(conv.seller_id);
    });

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, username, full_name, avatar_url, is_online, last_seen')
      .in('id', Array.from(participantIds));

    const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

    // Format conversations
    const formattedConversations = conversations?.map(conv => {
      const otherUserId = conv.buyer_id === userId ? conv.seller_id : conv.buyer_id;
      const otherUser = profileMap.get(otherUserId);
      const unreadCount = conv.buyer_id === userId 
        ? conv.unread_count_buyer 
        : conv.unread_count_seller;

      return {
        id: conv.conversation_id,
        otherUser: otherUser ? {
          id: otherUser.id,
          username: otherUser.username,
          fullName: otherUser.full_name,
          avatarUrl: otherUser.avatar_url,
          isOnline: otherUser.is_online,
          lastSeen: otherUser.last_seen
        } : null,
        productId: conv.product_id,
        orderId: conv.order_id,
        status: conv.status,
        lastMessage: conv.last_message_preview,
        lastMessageAt: conv.last_message_at,
        unreadCount: unreadCount || 0,
        createdAt: conv.created_at,
        updatedAt: conv.updated_at
      };
    });

    res.json({
      success: true,
      data: formattedConversations
    });
  } catch (error: any) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch conversations',
      error: error.message
    });
  }
});

// ================================================
// GET OR CREATE CONVERSATION
// ================================================
// ================================================
// GET OR CREATE CONVERSATION - FIXED
// ================================================
router.post('/conversations/get-or-create', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const { otherUserId, productId } = req.body;

    console.log('Get or create conversation request:', {
      currentUserId,
      otherUserId,
      productId
    });

    if (!otherUserId) {
      return res.status(400).json({
        success: false,
        message: 'otherUserId is required'
      });
    }

    // Use NULL if productId is not provided (for general inquiries)
    const validProductId = productId || null;

    // Check if conversation already exists
    let query = supabase
      .from('conversations')
      .select('conversation_id');
    
    // Build query based on whether productId is provided
    if (validProductId) {
      query = query.or(`and(buyer_id.eq.${currentUserId},seller_id.eq.${otherUserId},product_id.eq.${validProductId}),and(buyer_id.eq.${otherUserId},seller_id.eq.${currentUserId},product_id.eq.${validProductId})`);
    } else {
      // For general inquiries (no product), find conversation between users with null product_id
      query = query.or(`and(buyer_id.eq.${currentUserId},seller_id.eq.${otherUserId},product_id.is.null),and(buyer_id.eq.${otherUserId},seller_id.eq.${currentUserId},product_id.is.null)`);
    }
    
    const { data: existingConv, error: searchError } = await query
      .limit(1)
      .maybeSingle(); // Use maybeSingle() instead of single() to avoid error when not found

    if (searchError) {
      console.error('Error searching for conversation:', searchError);
      throw searchError;
    }

    if (existingConv) {
      console.log('Found existing conversation:', existingConv.conversation_id);
      return res.json({
        success: true,
        data: { conversationId: existingConv.conversation_id }
      });
    }

    // Create new conversation
    const conversationId = uuidv4();
    console.log('Creating new conversation:', conversationId);

    const { data: newConv, error: createError } = await supabase
      .from('conversations')
      .insert({
        conversation_id: conversationId,
        buyer_id: currentUserId,
        seller_id: otherUserId,
        product_id: validProductId,
        status: 'active',
        unread_count_buyer: 0,
        unread_count_seller: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('conversation_id')
      .single();

    if (createError) {
      console.error('Error creating conversation:', createError);
      throw createError;
    }

    console.log('Created new conversation:', newConv.conversation_id);

    res.json({
      success: true,
      data: { conversationId: newConv.conversation_id }
    });
  } catch (error: any) {
    console.error('Error in get-or-create conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create conversation',
      error: error.message,
      details: error.details || error.hint
    });
  }
});

// ================================================
// GET MESSAGES FOR A CONVERSATION
// ================================================
router.get('/conversations/:conversationId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const userId = req.user!.id;

    // Verify user is part of conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('buyer_id, seller_id')
      .eq('conversation_id', conversationId)
      .single();

    if (!conversation || (conversation.buyer_id !== userId && conversation.seller_id !== userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a participant in this conversation'
      });
    }

    // Fetch messages
   // In GET /conversations/:conversationId/messages
const { data: messages, error } = await supabase
  .from('messages')
  .select(`
    message_id,
    conversation_id,
    sender_id,
    content,
    message_type,
    metadata,
    is_read,
    created_at
  `)
  .eq('conversation_id', conversationId)
  .order('created_at', { ascending: true })
  .range(Number(offset), Number(offset) + Number(limit) - 1);

if (error) throw error;

// Get sender profiles
const senderIds = [...new Set(messages?.map(m => m.sender_id) || [])];
const { data: profiles } = await supabase
  .from('user_profiles')
  .select('id, username, full_name, avatar_url')
  .in('id', senderIds);

const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

const formattedMessages = messages?.map(msg => ({
  id: msg.message_id,
  conversationId: msg.conversation_id,
  senderId: msg.sender_id,
  content: msg.content,
  messageType: msg.message_type,
  imageUrl: msg.metadata?.image_url, // Extract from metadata
  isRead: msg.is_read,
  createdAt: msg.created_at,
  updatedAt: undefined,
  sender: profileMap.get(msg.sender_id)
}));

    res.json({
      success: true,
      data: formattedMessages
    });
  } catch (error: any) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages',
      error: error.message
    });
  }
});

// ================================================
// SEND A TEXT MESSAGE
// ================================================
router.post('/conversations/:conversationId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;
    const userId = req.user!.id;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    // Verify user is part of conversation
    const { data: conversation } = await supabase
      .from('conversations')
      .select('buyer_id, seller_id')
      .eq('conversation_id', conversationId)
      .single();

    if (!conversation || (conversation.buyer_id !== userId && conversation.seller_id !== userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a participant in this conversation'
      });
    }

    // Insert message
    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        message_id: uuidv4(),
        conversation_id: conversationId,
        sender_id: userId,
        content: content.trim(),
        message_type: 'text',
        is_read: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      data: message
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
});

// ================================================
// SEND AN IMAGE MESSAGE - CORRECT SCHEMA
// ================================================
router.post('/conversations/:conversationId/messages/image', 
  authenticateToken, 
  upload.single('image'), 
  async (req: AuthRequest, res: Response) => {
    try {
      const { conversationId } = req.params;
      const { content = '' } = req.body;
      const userId = req.user!.id;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Image file is required'
        });
      }

      // Verify user is part of conversation
      const { data: conversation } = await supabase
        .from('conversations')
        .select('buyer_id, seller_id')
        .eq('conversation_id', conversationId)
        .single();

      if (!conversation || (conversation.buyer_id !== userId && conversation.seller_id !== userId)) {
        return res.status(403).json({
          success: false,
          message: 'You are not a participant in this conversation'
        });
      }

      // Upload image to Supabase Storage
      const fileExt = req.file.originalname.split('.').pop() || 'jpg';
      const fileName = `${uuidv4()}.${fileExt}`;
      const filePath = `${conversationId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) {
        console.error('Storage upload error:', uploadError);
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      // Insert message - using metadata instead of payload
      const { data: message, error } = await supabase
        .from('messages')
        .insert({
          message_id: uuidv4(),
          conversation_id: conversationId,
          sender_id: userId,
          content: content.trim() || 'Image',
          message_type: 'image',
          metadata: { 
            image_url: publicUrl,
            file_name: req.file.originalname,
            file_size: req.file.size,
            file_type: req.file.mimetype,
            file_extension: fileExt
          },
          is_read: false,
          is_edited: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Database insert error:', error);
        throw error;
      }

      // Update conversation's last message
      await supabase
        .from('conversations')
        .update({
          last_message_preview: content.trim() || 'Image',
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('conversation_id', conversationId);

      res.json({
        success: true,
        data: {
          ...message,
          imageUrl: publicUrl
        }
      });
    } catch (error: any) {
      console.error('Error sending image message:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send image message',
        error: error.message
      });
    }
});

// ================================================
// MARK MESSAGES AS READ
// ================================================
router.post('/conversations/:conversationId/read', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user!.id;

    const { error } = await supabase
      .rpc('mark_messages_as_read', {
        p_conversation_id: conversationId,
        p_user_id: userId
      });

    if (error) throw error;

    res.json({
      success: true,
      message: 'Messages marked as read'
    });
  } catch (error: any) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: error.message
    });
  }
});

// ================================================
// UPDATE USER ONLINE STATUS
// ================================================
router.post('/status/online', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { isOnline } = req.body;
    const userId = req.user!.id;

    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        id: userId,
        is_online: isOnline,
        last_seen: new Date().toISOString()
      });

    if (error) throw error;

    res.json({
      success: true,
      message: 'Status updated'
    });
  } catch (error: any) {
    console.error('Error updating status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: error.message
    });
  }
});

// ================================================
// SET TYPING INDICATOR
// ================================================
router.post('/conversations/:conversationId/typing', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { isTyping } = req.body;
    const userId = req.user!.id;

    if (isTyping) {
      const { error } = await supabase
        .from('typing_indicators')
        .upsert({
          conversation_id: conversationId,
          user_id: userId,
          started_at: new Date().toISOString()
        });

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('typing_indicators')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', userId);

      if (error) throw error;
    }

    res.json({
      success: true,
      message: 'Typing indicator updated'
    });
  } catch (error: any) {
    console.error('Error updating typing indicator:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update typing indicator',
      error: error.message
    });
  }
});

// ================================================
// SEARCH CONVERSATIONS
// ================================================
router.get('/conversations/search', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.query;
    const userId = req.user!.id;

    if (!query || query.toString().trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const { data: conversations, error } = await supabase
      .from('conversations')
      .select(`
        conversation_id,
        buyer_id,
        seller_id,
        product_id,
        last_message_preview,
        last_message_at,
        unread_count_buyer,
        unread_count_seller,
        created_at
      `)
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .ilike('last_message_preview', `%${query}%`)
      .order('last_message_at', { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      data: conversations
    });
  } catch (error: any) {
    console.error('Error searching conversations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search conversations',
      error: error.message
    });
  }
});

// ================================================
// DELETE MESSAGE
// ================================================
router.delete('/messages/:messageId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;
    const userId = req.user!.id;

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('message_id', messageId)
      .eq('sender_id', userId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error: any) {
    console.error('Error deleting message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: error.message
    });
  }
});

export default router;