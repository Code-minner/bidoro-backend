// =============================================
// BIDORO Notification Service
// Location: backend/services/notification.service.ts
// =============================================

import { supabaseAdmin as supabase } from '../config/database';
import {
  Notification,
  CreateNotificationInput,
  NotificationFilters,
  NotificationListResponse,
  NotificationCategory,
  NotificationType,
  GroupedNotifications,
} from '../types/notification.types';

class NotificationService {
  // =============================================
  // Create Notifications
  // =============================================

  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: input.user_id,
        title: input.title,
        message: input.message,
        category: input.category || 'account',
        type: input.type || 'info',
        metadata: input.metadata || {},
        action_url: input.action_url || null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create notification: ${error.message}`);
    return data;
  }

  async createBulkNotifications(inputs: CreateNotificationInput[]): Promise<Notification[]> {
    const notifications = inputs.map(input => ({
      user_id: input.user_id,
      title: input.title,
      message: input.message,
      category: input.category || 'account',
      type: input.type || 'info',
      metadata: input.metadata || {},
      action_url: input.action_url || null,
    }));

    const { data, error } = await supabase
      .from('notifications')
      .insert(notifications)
      .select();

    if (error) throw new Error(`Failed to create notifications: ${error.message}`);
    return data;
  }

  // =============================================
  // Read Notifications
  // =============================================

  async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20,
    filters?: NotificationFilters
  ): Promise<NotificationListResponse> {
    const offset = (page - 1) * limit;

    let query = supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (filters?.category) {
      query = query.eq('category', filters.category);
    }
    if (filters?.is_read !== undefined) {
      query = query.eq('is_read', filters.is_read);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);

    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    return {
      notifications: data || [],
      unread_count: unreadCount || 0,
      total: count || 0,
      pagination: {
        page,
        limit,
        total_pages: Math.ceil((count || 0) / limit),
      },
    };
  }

  async getGroupedNotifications(
    userId: string,
    category?: NotificationCategory
  ): Promise<GroupedNotifications> {
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const groups: GroupedNotifications = {
      recent: [],
      thisWeek: [],
      earlier: [],
    };

    (data || []).forEach((notification: Notification) => {
      const createdAt = new Date(notification.created_at);
      
      if (createdAt >= oneDayAgo) {
        groups.recent.push(notification);
      } else if (createdAt >= oneWeekAgo) {
        groups.thisWeek.push(notification);
      } else {
        groups.earlier.push(notification);
      }
    });

    return groups;
  }

  async getNotificationById(userId: string, notificationId: string): Promise<Notification | null> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('id', notificationId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to fetch notification: ${error.message}`);
    }

    return data;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw new Error(`Failed to fetch unread count: ${error.message}`);
    return count || 0;
  }

  // =============================================
  // Update Notifications
  // =============================================

  async markAsRead(userId: string, notificationId: string): Promise<Notification> {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new Error(`Failed to mark notification as read: ${error.message}`);
    return data;
  }

  async markAsUnread(userId: string, notificationId: string): Promise<Notification> {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: false, read_at: null })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new Error(`Failed to mark notification as unread: ${error.message}`);
    return data;
  }

  async markAllAsRead(userId: string, category?: NotificationCategory): Promise<number> {
    let query = supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query.select();

    if (error) throw new Error(`Failed to mark notifications as read: ${error.message}`);
    return data?.length || 0;
  }

  // =============================================
  // Delete Notifications
  // =============================================

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) throw new Error(`Failed to delete notification: ${error.message}`);
  }

  async deleteReadNotifications(userId: string): Promise<number> {
    const { data, error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId)
      .eq('is_read', true)
      .select();

    if (error) throw new Error(`Failed to delete notifications: ${error.message}`);
    return data?.length || 0;
  }

  // =============================================
  // Helper Methods for Creating Notifications
  // =============================================

  async createOrderNotification(
    userId: string,
    orderId: string,
    status: 'placed' | 'processing' | 'shipped' | 'delivered' | 'cancelled',
    additionalInfo?: Record<string, any>
  ): Promise<Notification> {
    const templates: Record<string, { title: string; message: string; type: NotificationType }> = {
      placed: {
        title: 'Order Placed Successfully',
        message: `Your order #${orderId} has been placed and is being processed.`,
        type: 'success',
      },
      processing: {
        title: 'Order Being Processed',
        message: `Your order #${orderId} is now being prepared for shipping.`,
        type: 'info',
      },
      shipped: {
        title: 'Order Shipped',
        message: `Your order #${orderId} has been shipped and is on its way!`,
        type: 'info',
      },
      delivered: {
        title: 'Order Delivered',
        message: `Your order #${orderId} has been delivered. Enjoy your purchase!`,
        type: 'success',
      },
      cancelled: {
        title: 'Order Cancelled',
        message: `Your order #${orderId} has been cancelled.`,
        type: 'warning',
      },
    };

    const template = templates[status];

    return this.createNotification({
      user_id: userId,
      title: template.title,
      message: template.message,
      category: 'orders',
      type: template.type,
      metadata: { order_id: orderId, order_status: status, ...additionalInfo },
      action_url: `/orders/${orderId}`,
    });
  }

  async createReferralNotification(
    userId: string,
    type: 'signup' | 'purchase',
    referredName: string,
    pointsEarned: number
  ): Promise<Notification> {
    const templates = {
      signup: {
        title: 'Referral Bonus Earned!',
        message: `You earned ${pointsEarned} points! ${referredName} signed up using your referral code.`,
      },
      purchase: {
        title: 'Referral Purchase Bonus!',
        message: `You earned ${pointsEarned} more points! ${referredName} made their first purchase.`,
      },
    };

    const template = templates[type];

    return this.createNotification({
      user_id: userId,
      title: template.title,
      message: template.message,
      category: 'referral',
      type: 'success',
      metadata: { referred_name: referredName, points_earned: pointsEarned, referral_type: type },
      action_url: '/earn',
    });
  }

  async createPromotionNotification(
    userId: string,
    title: string,
    message: string,
    promoCode?: string,
    expiresAt?: string,
    actionUrl?: string
  ): Promise<Notification> {
    return this.createNotification({
      user_id: userId,
      title,
      message,
      category: 'promotions',
      type: 'info',
      metadata: { promo_code: promoCode, expires_at: expiresAt },
      action_url: actionUrl,
    });
  }

  async createAccountNotification(
    userId: string,
    title: string,
    message: string,
    type: NotificationType = 'info',
    actionUrl?: string
  ): Promise<Notification> {
    return this.createNotification({
      user_id: userId,
      title,
      message,
      category: 'account',
      type,
      action_url: actionUrl,
    });
  }

  async createWelcomeNotification(userId: string, userName: string): Promise<Notification> {
    return this.createNotification({
      user_id: userId,
      title: 'Welcome to Bidoro! 🎉',
      message: `Hi ${userName}, welcome to Bidoro marketplace! Start exploring amazing products from trusted sellers.`,
      category: 'account',
      type: 'success',
      action_url: '/products',
    });
  }

  // =============================================
  // Notification Settings/Preferences
  // =============================================

  async getNotificationSettings(userId: string): Promise<any> {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return {
        bidding: false,
        new_order: true,
        messages: true,
        new_rating: true,
        feedback: true,
        wallet_withdrawal: true,
        web_notification: true,
        email_notification: true,
        sms_notification: true,
      };
    }

    return data;
  }

  async updateNotificationSettings(userId: string, settings: Record<string, boolean>): Promise<any> {
    const { data: existing } = await supabase
      .from('notification_preferences')
      .select('id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      const { data, error } = await supabase
        .from('notification_preferences')
        .update({ ...settings, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw new Error(`Failed to update settings: ${error.message}`);
      return data;
    } else {
      const defaults = {
        bidding: false,
        new_order: true,
        messages: true,
        new_rating: true,
        feedback: true,
        wallet_withdrawal: true,
        web_notification: true,
        email_notification: true,
        sms_notification: true,
      };
      
      const { data, error } = await supabase
        .from('notification_preferences')
        .insert({ user_id: userId, ...defaults, ...settings })
        .select()
        .single();

      if (error) throw new Error(`Failed to create settings: ${error.message}`);
      return data;
    }
  }
}

export const notificationService = new NotificationService();
export default NotificationService;