// =============================================
// BIDORO Notification Routes
// Location: backend/routes/notification.routes.ts
// =============================================

import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import {
  getNotifications,
  getGroupedNotifications,
  getNotificationById,
  getUnreadCount,
  markAsRead,
  markAsUnread,
  markAllAsRead,
  deleteNotification,
  clearReadNotifications,
  getNotificationSettings,
  updateNotificationSettings,
} from '../controllers/notification.controller';

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// =============================================
// GET Routes
// =============================================

// Get paginated notifications with filters
router.get('/', getNotifications);

// Get grouped notifications (recent, this week, earlier)
router.get('/grouped', getGroupedNotifications);

// Get unread count
router.get('/unread-count', getUnreadCount);

// Get notification settings
router.get('/settings', getNotificationSettings);

// Get single notification (must be after other specific routes)
router.get('/:id', getNotificationById);

// =============================================
// PATCH Routes
// =============================================

// Mark all as read
router.patch('/read-all', markAllAsRead);

// Mark single notification as read
router.patch('/:id/read', markAsRead);

// Mark single notification as unread
router.patch('/:id/unread', markAsUnread);

// =============================================
// PUT Routes
// =============================================

// Update notification settings
router.put('/settings', updateNotificationSettings);

// =============================================
// DELETE Routes
// =============================================

// Clear all read notifications
router.delete('/clear-read', clearReadNotifications);

// Delete single notification
router.delete('/:id', deleteNotification);

export default router;