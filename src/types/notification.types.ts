// =============================================
// BIDORO Notification Types
// Location: backend/types/notification.types.ts
// =============================================

// Add 'messages' to the category list
export type NotificationCategory = 'orders' | 'promotions' | 'account' | 'support' | 'referral' | 'messages';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  type: NotificationType;
  is_read: boolean;
  read_at: string | null;
  metadata: Record<string, any>;
  action_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNotificationInput {
  user_id: string;
  title: string;
  message: string;
  category?: NotificationCategory;
  type?: NotificationType;
  metadata?: Record<string, any>;
  action_url?: string;
}

export interface NotificationFilters {
  category?: NotificationCategory;
  is_read?: boolean;
}

export interface NotificationListResponse {
  notifications: Notification[];
  unread_count: number;
  total: number;
  pagination: {
    page: number;
    limit: number;
    total_pages: number;
  };
}

export interface GroupedNotifications {
  recent: Notification[];
  thisWeek: Notification[];
  earlier: Notification[];
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  
  // Notification type settings
  bidding: boolean;
  new_order: boolean;
  messages: boolean;
  new_rating: boolean;
  feedback: boolean;
  wallet_withdrawal: boolean;
  
  // Delivery method settings
  web_notification: boolean;
  email_notification: boolean;
  sms_notification: boolean;
  
  created_at: string;
  updated_at: string;
}