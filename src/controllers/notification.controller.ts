// =============================================
// BIDORO Notification Controller
// Location: backend/controllers/notification.controller.ts
// =============================================

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { notificationService } from '../services/notification.service';
import { NotificationCategory } from '../types/notification.types';

/**
 * Get user's notifications with pagination and filters
 * GET /api/notifications
 */
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const category = req.query.category as NotificationCategory | undefined;
    const isRead = req.query.is_read === 'true' ? true : req.query.is_read === 'false' ? false : undefined;

    const result = await notificationService.getUserNotifications(userId, page, limit, {
      category,
      is_read: isRead,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch notifications',
    });
  }
};

/**
 * Get grouped notifications for dashboard
 * GET /api/notifications/grouped
 */
export const getGroupedNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const category = req.query.category as NotificationCategory | undefined;

    const groups = await notificationService.getGroupedNotifications(userId, category);
    const unreadCount = await notificationService.getUnreadCount(userId);

    res.status(200).json({
      success: true,
      data: {
        groups,
        unread_count: unreadCount,
      },
    });
  } catch (error: any) {
    console.error('Get grouped notifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch notifications',
    });
  }
};

/**
 * Get single notification by ID
 * GET /api/notifications/:id
 */
export const getNotificationById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const notification = await notificationService.getNotificationById(userId, id);

    if (!notification) {
      res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: { notification },
    });
  } catch (error: any) {
    console.error('Get notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch notification',
    });
  }
};

/**
 * Get unread notifications count
 * GET /api/notifications/unread-count
 */
export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const count = await notificationService.getUnreadCount(userId);

    res.status(200).json({
      success: true,
      data: { unread_count: count },
    });
  } catch (error: any) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch unread count',
    });
  }
};

/**
 * Mark notification as read
 * PATCH /api/notifications/:id/read
 */
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const notification = await notificationService.markAsRead(userId, id);

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: { notification },
    });
  } catch (error: any) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to mark notification as read',
    });
  }
};

/**
 * Mark notification as unread
 * PATCH /api/notifications/:id/unread
 */
export const markAsUnread = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const notification = await notificationService.markAsUnread(userId, id);

    res.status(200).json({
      success: true,
      message: 'Notification marked as unread',
      data: { notification },
    });
  } catch (error: any) {
    console.error('Mark as unread error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to mark notification as unread',
    });
  }
};

/**
 * Mark all notifications as read
 * PATCH /api/notifications/read-all
 */
export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const category = req.query.category as NotificationCategory | undefined;

    const count = await notificationService.markAllAsRead(userId, category);

    res.status(200).json({
      success: true,
      message: `${count} notifications marked as read`,
      data: { updated_count: count },
    });
  } catch (error: any) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to mark notifications as read',
    });
  }
};

/**
 * Delete notification
 * DELETE /api/notifications/:id
 */
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    await notificationService.deleteNotification(userId, id);

    res.status(200).json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (error: any) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete notification',
    });
  }
};

/**
 * Delete all read notifications
 * DELETE /api/notifications/clear-read
 */
export const clearReadNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const count = await notificationService.deleteReadNotifications(userId);

    res.status(200).json({
      success: true,
      message: `${count} read notifications deleted`,
      data: { deleted_count: count },
    });
  } catch (error: any) {
    console.error('Clear read notifications error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to clear notifications',
    });
  }
};

/**
 * Get notification settings
 * GET /api/notifications/settings
 */
export const getNotificationSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const settings = await notificationService.getNotificationSettings(userId);

    res.status(200).json({
      success: true,
      data: { settings },
    });
  } catch (error: any) {
    console.error('Get notification settings error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch notification settings',
    });
  }
};

/**
 * Update notification settings
 * PUT /api/notifications/settings
 */
export const updateNotificationSettings = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const settings = req.body;

    const updated = await notificationService.updateNotificationSettings(userId, settings);

    res.status(200).json({
      success: true,
      message: 'Notification settings updated',
      data: { settings: updated },
    });
  } catch (error: any) {
    console.error('Update notification settings error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update notification settings',
    });
  }
};