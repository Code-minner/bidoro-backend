// ================================================
// BIDORO BACKEND - MESSAGES API ROUTES
// File: src/routes/messages.ts
// WITH NOTIFICATION INTEGRATION
// ================================================

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
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
// HELPER: Send message notification
// ================================================
async function sendMessageNotification(
  recipientId: string, 
  senderId: string, 
  messagePreview: string,
  conversationId: string
) {
  try {
    // Get sender name
    const { data: sender } = await supabase
      .from('users')
      .select('name')
      .eq('user_id', senderId)
      .single();

    const senderName = sender?.name || 'Someone';
    const truncatedMessage = messagePreview.length > 50 
      ? messagePreview.substring(0, 50) + '...' 
      : messagePreview;

    await notificationService.createNotification({
      user_id: recipientId,
      title: `New message from ${senderName}`,
      message: truncatedMessage,
      category: 'messages',
      type: 'info',
      action_url: `/messager?conversation=${conversationId}`,
      metadata: {
        sender_id: senderId,
        sender_name: senderName,
        conversation_id: conversationId
      }
    });
  } catch (error) {
    console.error('Failed to send message notification:', error);
    // Don't throw - notification failure shouldn't break messaging
  }
}

// ================================================
// GET ALL CONVERSATIONS FOR CURRENT USER
// ================================================
router.get('/conversations', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    console.log('Fetching conversations for user:', userId);

    // Get conversations where user is buyer OR seller
    // Using two separate queries and merging to ensure correct filtering
    const { data: buyerConversations, error: buyerError } = await supabase
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
        referenced_items,
        created_at,
        updated_at
      `)
      .eq('buyer_id', userId);

    const { data: sellerConversations, error: sellerError } = await supabase
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
        referenced_items,
        created_at,
        updated_at
      `)
      .eq('seller_id', userId);

    if (buyerError) throw buyerError;
    if (sellerError) throw sellerError;

    // Merge and deduplicate conversations
    const conversationMap = new Map();
    
    [...(buyerConversations || []), ...(sellerConversations || [])].forEach(conv => {
      if (!conversationMap.has(conv.conversation_id)) {
        conversationMap.set(conv.conversation_id, conv);
      }
    });

    // Convert to array and sort by last_message_at
    const conversations = Array.from(conversationMap.values()).sort((a, b) => {
      const dateA = a.last_message_at ? new Date(a.last_message_at).getTime() : new Date(a.created_at).getTime();
      const dateB = b.last_message_at ? new Date(b.last_message_at).getTime() : new Date(b.created_at).getTime();
      return dateB - dateA; // Descending order (newest first)
    });

    console.log(`Found ${conversations.length} conversations for user ${userId}`);

    // Get user profiles for all participants
    const participantIds = new Set<string>();
    conversations?.forEach(conv => {
      participantIds.add(conv.buyer_id);
      participantIds.add(conv.seller_id);
    });

    const { data: profiles } = await supabase
      .from('users')
      .select('user_id, name, email, profile_picture')
      .in('user_id', Array.from(participantIds));

    const { data: userProfiles } = await supabase
      .from('user_profiles')
      .select('id, username, full_name, is_online, last_seen')
      .in('id', Array.from(participantIds));

    const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
    const userProfileMap = new Map(userProfiles?.map(p => [p.id, p]) || []);

    // Format conversations
    const formattedConversations = conversations?.map(conv => {
      const otherUserId = conv.buyer_id === userId ? conv.seller_id : conv.buyer_id;
      const userProfile = profileMap.get(otherUserId);
      const onlineStatus = userProfileMap.get(otherUserId);
      const unreadCount = conv.buyer_id === userId 
        ? conv.unread_count_buyer 
        : conv.unread_count_seller;

      return {
        id: conv.conversation_id,
        otherUser: userProfile ? {
          id: otherUserId,
          username: onlineStatus?.username || userProfile.name,
          fullName: onlineStatus?.full_name || userProfile.name,
          avatarUrl: userProfile.profile_picture,
          isOnline: onlineStatus?.is_online || false,
          lastSeen: onlineStatus?.last_seen || new Date().toISOString()
        } : null,
        productId: conv.product_id,
        orderId: conv.order_id,
        status: conv.status,
        lastMessage: conv.last_message_preview,
        lastMessageAt: conv.last_message_at,
        unreadCount: unreadCount || 0,
        referencedItems: conv.referenced_items || [],
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
// One chat per user pair - context stored separately
// ================================================
router.post('/conversations/get-or-create', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const { otherUserId, productId, requestId } = req.body;

    if (!otherUserId) {
      return res.status(400).json({
        success: false,
        message: 'otherUserId is required'
      });
    }

    // Find ANY existing conversation between these two users
    const { data: existingConversations, error: searchError } = await supabase
      .from('conversations')
      .select('conversation_id, product_id, last_message_at, created_at')
      .or(`and(buyer_id.eq.${currentUserId},seller_id.eq.${otherUserId}),and(buyer_id.eq.${otherUserId},seller_id.eq.${currentUserId})`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1);

    if (searchError) throw searchError;

    // Prepare context reference if provided
    const contextRef = productId 
      ? { type: 'product', id: productId, added_at: new Date().toISOString() }
      : requestId 
        ? { type: 'request', id: requestId, added_at: new Date().toISOString() }
        : null;

    // If conversation exists, return it
    if (existingConversations && existingConversations.length > 0) {
      const existingConv = existingConversations[0];
      
      // Try to add context to referenced_items (optional - column may not exist)
      if (contextRef) {
        try {
          const { data: convWithRefs } = await supabase
            .from('conversations')
            .select('referenced_items')
            .eq('conversation_id', existingConv.conversation_id)
            .single();
          
          const existingRefs = convWithRefs?.referenced_items || [];
          const alreadyReferenced = existingRefs.some(
            (ref: any) => ref.type === contextRef.type && ref.id === contextRef.id
          );
          
          if (!alreadyReferenced) {
            await supabase
              .from('conversations')
              .update({
                referenced_items: [...existingRefs, contextRef],
                updated_at: new Date().toISOString()
              })
              .eq('conversation_id', existingConv.conversation_id);
          }
        } catch (refError) {
          // Column might not exist - that's okay
          console.log('Could not update referenced_items:', refError);
        }
      }

      return res.json({
        success: true,
        data: { 
          conversationId: existingConv.conversation_id,
          isNew: false,
          context: contextRef
        }
      });
    }

    // No conversation exists, create a new one
    const conversationId = uuidv4();

    // Build insert data - only include referenced_items if it might exist
    const insertData: any = {
      conversation_id: conversationId,
      buyer_id: currentUserId,
      seller_id: otherUserId,
      product_id: productId || null,
      status: 'active',
      unread_count_buyer: 0,
      unread_count_seller: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data: newConv, error: createError } = await supabase
      .from('conversations')
      .insert(insertData)
      .select('conversation_id')
      .single();

    if (createError) throw createError;

    // Try to set referenced_items separately (in case column exists)
    if (contextRef) {
      try {
        await supabase
          .from('conversations')
          .update({ referenced_items: [contextRef] })
          .eq('conversation_id', conversationId);
      } catch (refError) {
        console.log('Could not set referenced_items:', refError);
      }
    }

    res.json({
      success: true,
      data: { 
        conversationId: newConv.conversation_id,
        isNew: true,
        context: contextRef
      }
    });
  } catch (error: any) {
    console.error('Error in get-or-create conversation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create conversation',
      error: error.message
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
      metadata: msg.metadata,
      imageUrl: msg.metadata?.image_url,
      isRead: msg.is_read,
      createdAt: msg.created_at,
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
// SEND MESSAGE - WITH NOTIFICATION AND CONTEXT
// ================================================
router.post('/conversations/:conversationId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { content, productReference, context } = req.body;
    // context = { type: 'product' | 'request', id: string, title?: string }
    
    // DEBUG: Log the user object
    console.log('DEBUG req.user:', req.user);
    
    // Handle both 'id' and 'userId' from JWT
    const userId = req.user!.id;
    
    console.log('DEBUG userId:', userId);

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    // Verify user is part of conversation and get recipient
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

    // Determine recipient
    const recipientId = conversation.buyer_id === userId 
      ? conversation.seller_id 
      : conversation.buyer_id;

    // Determine message type - context messages are still 'text' type
    // (context info is stored in metadata, not message_type)
    const messageType = productReference ? 'product' : 'text';
    
    // Build metadata - include context if provided
    let metadata: any = null;
    
    if (productReference) {
      metadata = {
        productId: productReference.productId,
        productName: productReference.productName,
        productPrice: productReference.productPrice,
        productImage: productReference.productImage,
        condition: productReference.condition,
        negotiable: productReference.negotiable,
        verified: productReference.verified
      };
    } else if (context) {
      metadata = {
        context_type: context.type,
        context_id: context.id,
        context_title: context.title
      };
    }

    // Insert message with context
    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        message_id: uuidv4(),
        conversation_id: conversationId,
        sender_id: userId,
        content: content.trim(),
        message_type: messageType,
        metadata: metadata,
        is_read: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // If context provided, try to add to conversation's referenced_items
    // This is optional - if the column doesn't exist, we just skip it
    if (context && context.type && context.id) {
      try {
        const { data: convData } = await supabase
          .from('conversations')
          .select('referenced_items')
          .eq('conversation_id', conversationId)
          .single();
        
        const existingRefs = convData?.referenced_items || [];
        const alreadyReferenced = existingRefs.some(
          (ref: any) => ref.type === context.type && ref.id === context.id
        );
        
        if (!alreadyReferenced) {
          await supabase
            .from('conversations')
            .update({
              referenced_items: [...existingRefs, {
                type: context.type,
                id: context.id,
                title: context.title,
                added_at: new Date().toISOString()
              }]
            })
            .eq('conversation_id', conversationId);
        }
      } catch (refError) {
        // Column might not exist yet - that's okay, just log and continue
        console.log('Could not update referenced_items (column may not exist):', refError);
      }
    }

    // Update conversation's last message
    const isSenderBuyer = conversation.buyer_id === userId;
    const updateData: any = {
      last_message_preview: content.trim(),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Increment unread count for recipient
    if (isSenderBuyer) {
      updateData.unread_count_seller = supabase.rpc('increment', { x: 1 });
    } else {
      updateData.unread_count_buyer = supabase.rpc('increment', { x: 1 });
    }

    await supabase
      .from('conversations')
      .update({
        last_message_preview: content.trim(),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('conversation_id', conversationId);

    // =============================================
    // SEND NOTIFICATION TO RECIPIENT
    // =============================================
    await sendMessageNotification(recipientId, userId, content.trim(), conversationId);

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
// SEND IMAGE MESSAGE - WITH NOTIFICATION
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

      // Determine recipient
      const recipientId = conversation.buyer_id === userId 
        ? conversation.seller_id 
        : conversation.buyer_id;

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

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filePath);

      // Insert message
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
            file_type: req.file.mimetype
          },
          is_read: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Update conversation
      await supabase
        .from('conversations')
        .update({
          last_message_preview: '📷 Image',
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('conversation_id', conversationId);

      // =============================================
      // SEND NOTIFICATION TO RECIPIENT
      // =============================================
      await sendMessageNotification(recipientId, userId, '📷 Sent an image', conversationId);

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

    // Mark messages as read
    const { error } = await supabase
      .rpc('mark_messages_as_read', {
        p_conversation_id: conversationId,
        p_user_id: userId
      });

    if (error) throw error;

    // =============================================
    // ALSO MARK RELATED NOTIFICATIONS AS READ
    // =============================================
    try {
      const count = await notificationService.markMessageNotificationsAsRead(userId, conversationId);
      if (count > 0) {
        console.log(`Marked ${count} message notification(s) as read for conversation ${conversationId}`);
      }
    } catch (notifError) {
      console.error('Failed to mark notifications as read:', notifError);
      // Don't fail the request if notification update fails
    }

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

// ================================================
// GET PRODUCT BY ID
// ================================================
router.get('/products/:productId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { productId } = req.params;

    const { data: product, error } = await supabase
      .from('products')
      .select('*')
      .eq('product_id', productId)
      .single();

    if (error || !product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const { data: productImages } = await supabase
      .from('product_images')
      .select('*')
      .eq('product_id', productId)
      .order('display_order', { ascending: true });

    let productImage = null;
    if (productImages && productImages.length > 0) {
      const img = productImages[0];
      productImage = img.image_url || img.url || img.image;
    }

    let seller = null;
    if (product.seller_id) {
      const { data: sellerData } = await supabase
        .from('users')
        .select('user_id, name, profile_picture')
        .eq('user_id', product.seller_id)
        .single();
      seller = sellerData;
    }

    res.json({
      success: true,
      data: {
        id: product.product_id,
        name: product.name,
        price: parseFloat(product.price) || product.price,
        image: productImage || '/placeholder-product.png',
        images: productImages?.map(img => img.image_url || img.url) || [],
        condition: product.condition,
        negotiable: product.negotiable ?? true,
        verified: product.receipt_verified || false,
        sellerId: product.seller_id,
        sellerName: seller?.name || 'Unknown Seller',
        sellerAvatar: seller?.profile_picture
      }
    });
  } catch (error: any) {
    console.error('Error fetching product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product',
      error: error.message
    });
  }
});

export default router;