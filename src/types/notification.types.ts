// =============================================
// BIDORO Notification Types
// Location: backend/types/notification.types.ts
// =============================================

export type NotificationCategory = 'orders' | 'promotions' | 'account' | 'support' | 'referral';
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

export interface NotificationPreferences {
  id: string;
  user_id: string;
  email_orders: boolean;
  email_promotions: boolean;
  email_account: boolean;
  email_support: boolean;
  email_referral: boolean;
  push_orders: boolean;
  push_promotions: boolean;
  push_account: boolean;
  push_support: boolean;
  push_referral: boolean;
}

// Grouped notifications for frontend
export interface GroupedNotifications {
  recent: Notification[];      // Last 24 hours
  thisWeek: Notification[];    // Last 7 days
  earlier: Notification[];     // Older
}