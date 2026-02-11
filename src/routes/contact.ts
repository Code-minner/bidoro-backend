// src/routes/contact.ts
import { Router, Request, Response } from 'express';
import { supabase, supabaseAdmin } from '../config/database';
import { emailService } from '../services/emailService';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiter - 5 messages per 15 minutes per IP
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: {
    success: false,
    message: 'Too many contact requests. Please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Simple spam detection keywords
const spamKeywords = [
  'viagra', 'casino', 'lottery', 'prize', 'winner',
  'click here', 'limited time', 'act now', 'free money'
];

const calculateSpamScore = (text: string): number => {
  let score = 0;
  const lowerText = text.toLowerCase();
  
  spamKeywords.forEach(keyword => {
    if (lowerText.includes(keyword)) {
      score += 20;
    }
  });
  
  // Check for excessive links
  const linkCount = (text.match(/https?:\/\//g) || []).length;
  if (linkCount > 3) score += 30;
  
  // Check for excessive caps
  const capsPercentage = (text.match(/[A-Z]/g) || []).length / text.length;
  if (capsPercentage > 0.5) score += 20;
  
  return Math.min(score, 100);
};

// Manual validation function
const validateContactForm = (data: any): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Name validation
  if (!data.name || typeof data.name !== 'string') {
    errors.push('Name is required');
  } else if (data.name.trim().length < 2 || data.name.trim().length > 255) {
    errors.push('Name must be between 2 and 255 characters');
  }

  // Email validation
  if (!data.email || typeof data.email !== 'string') {
    errors.push('Email is required');
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      errors.push('Please provide a valid email address');
    }
  }

  // Phone validation (optional)
  if (data.phone && data.phone.length > 50) {
    errors.push('Phone number is too long');
  }

  // Subject validation (optional)
  if (data.subject && data.subject.length > 255) {
    errors.push('Subject is too long');
  }

  // Message validation
  if (!data.message || typeof data.message !== 'string') {
    errors.push('Message is required');
  } else if (data.message.trim().length < 10 || data.message.trim().length > 5000) {
    errors.push('Message must be between 10 and 5000 characters');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * @route   POST /contact
 * @desc    Submit contact form
 * @access  Public
 */
router.post(
  '/',
  contactLimiter,
  async (req: Request, res: Response) => {
    try {
      // Validate input
      const validation = validateContactForm(req.body);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: validation.errors,
        });
      }

      const { name, email, phone, subject, message } = req.body;

      // Sanitize inputs
      const sanitizedName = name.trim();
      const sanitizedEmail = email.trim().toLowerCase();
      const sanitizedMessage = message.trim();

      // Get client info
      const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
      const userAgent = req.get('user-agent') || 'unknown';

      // Calculate spam score
      const spamScore = calculateSpamScore(sanitizedMessage);
      const isSpam = spamScore > 50;

      // Save to database using Supabase
      const { data, error } = await supabase
        .from('contact_messages')
        .insert([{
          name: sanitizedName,
          email: sanitizedEmail,
          phone: phone || null,
          subject: subject || null,
          message: sanitizedMessage,
          ip_address: ipAddress,
          user_agent: userAgent,
          spam_score: spamScore,
          is_spam: isSpam
        }])
        .select('id')
        .single();

      if (error) {
        console.error('Database error:', error);
        throw new Error('Failed to save message to database');
      }

      const messageId = data.id;

      // If not spam, send emails
      if (!isSpam) {
        try {
          // Send confirmation email to user
          await emailService.sendContactConfirmationEmail({
            name: sanitizedName,
            email: sanitizedEmail,
            messageId: messageId.toString(),
          });

          // Send notification to admin
          await emailService.sendAdminContactNotification({
            name: sanitizedName,
            email: sanitizedEmail,
            phone: phone || 'Not provided',
            subject: subject || 'General Inquiry',
            message: sanitizedMessage,
            messageId: messageId.toString(),
          });
        } catch (emailError) {
          console.error('Email sending failed:', emailError);
          // Don't fail the request if email fails
        }
      }

      res.status(201).json({
        success: true,
        message: isSpam 
          ? 'Your message has been received and is under review.'
          : 'Thank you for contacting us! We\'ll get back to you soon.',
        messageId,
      });

    } catch (error: any) {
      console.error('Contact form error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send message. Please try again later.',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  }
);

/**
 * @route   GET /messages
 * @desc    Get all contact messages (Admin only)
 * @access  Admin
 */
router.get('/messages', async (req: Request, res: Response) => {
  try {
    // TODO: Add admin authentication middleware
    
    const { 
      status, 
      is_spam, 
      page = 1, 
      limit = 20,
      search 
    } = req.query;

    let query = supabaseAdmin.from('contact_messages').select('*', { count: 'exact' });

    // Filter by status
    if (status) {
      query = query.eq('status', status);
    }

    // Filter by spam status
    if (is_spam !== undefined) {
      query = query.eq('is_spam', is_spam === 'true');
    }

    // Search
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,message.ilike.%${search}%`);
    }

    // Add pagination
    const offset = (Number(page) - 1) * Number(limit);
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data: data || [],
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / Number(limit)),
      },
    });

  } catch (error: any) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /messages/:id
 * @desc    Get single contact message (Admin only)
 * @access  Admin
 */
router.get('/messages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('contact_messages')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Message not found',
      });
    }

    // Mark as read if status is 'new'
    if (data.status === 'new') {
      await supabaseAdmin
        .from('contact_messages')
        .update({ status: 'read' })
        .eq('id', id);
    }

    res.json({
      success: true,
      data,
    });

  } catch (error: any) {
    console.error('Get message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   PATCH /messages/:id
 * @desc    Update contact message status (Admin only)
 * @access  Admin
 */
router.patch('/messages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, admin_notes, is_spam } = req.body;

    const updates: any = {};

    if (status) {
      updates.status = status;
      
      if (status === 'replied') {
        updates.replied_at = new Date().toISOString();
      }
    }

    if (admin_notes !== undefined) {
      updates.admin_notes = admin_notes;
    }

    if (is_spam !== undefined) {
      updates.is_spam = is_spam;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No updates provided',
      });
    }

    const { data, error } = await supabaseAdmin
      .from('contact_messages')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({
        success: false,
        message: 'Message not found',
      });
    }

    res.json({
      success: true,
      message: 'Message updated successfully',
      data,
    });

  } catch (error: any) {
    console.error('Update message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   DELETE /messages/:id
 * @desc    Delete contact message (Admin only)
 * @access  Admin
 */
router.delete('/messages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('contact_messages')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Message not found',
      });
    }

    res.json({
      success: true,
      message: 'Message deleted successfully',
    });

  } catch (error: any) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @route   GET /stats
 * @desc    Get contact message statistics (Admin only)
 * @access  Admin
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    // Get all messages to calculate stats
    const { data: messages, error } = await supabaseAdmin
      .from('contact_messages')
      .select('status, is_spam, created_at');

    if (error) {
      throw error;
    }

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const stats = {
      total: messages?.length || 0,
      new: messages?.filter(m => m.status === 'new').length || 0,
      read: messages?.filter(m => m.status === 'read').length || 0,
      replied: messages?.filter(m => m.status === 'replied').length || 0,
      spam: messages?.filter(m => m.is_spam === true).length || 0,
      today: messages?.filter(m => new Date(m.created_at) >= oneDayAgo).length || 0,
      this_week: messages?.filter(m => new Date(m.created_at) >= oneWeekAgo).length || 0,
    };

    res.json({
      success: true,
      data: stats,
    });

  } catch (error: any) {
    console.error('Get stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

export default router;