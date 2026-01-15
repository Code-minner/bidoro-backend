import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { authenticateToken } from '../middleware/auth';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // ← CORRECT
);

// =============================================
// TYPES
// =============================================

interface CreateReviewBody {
  sellerId: string;
  orderId?: string;
  communicationRating: number;
  shippingRating: number;
  itemAuthenticityRating: number;
  reviewText?: string;
}

interface CreateReplyBody {
  replyText: string;
}

interface UpdateReviewBody {
  communicationRating?: number;
  shippingRating?: number;
  itemAuthenticityRating?: number;
  reviewText?: string;
}

// =============================================
// GET SELLER RATINGS SUMMARY
// =============================================

router.get('/seller/:sellerId/ratings', async (req: Request, res: Response) => {
  try {
    const { sellerId } = req.params;

    // Get ratings summary
    const { data: summary, error: summaryError } = await supabase
      .from('seller_ratings_summary')
      .select('*')
      .eq('seller_id', sellerId)
      .single();

    if (summaryError && summaryError.code !== 'PGRST116') {
      throw summaryError;
    }

    // If no summary exists, return default values
    const ratingsData = summary || {
      seller_id: sellerId,
      avg_communication: 0,
      avg_shipping: 0,
      avg_item_authenticity: 0,
      avg_overall: 0,
      total_reviews: 0,
      five_star_count: 0,
      four_star_count: 0,
      three_star_count: 0,
      two_star_count: 0,
      one_star_count: 0,
    };

    res.json({
      success: true,
      data: {
        sellerId: ratingsData.seller_id,
        ratings: {
          communication: parseFloat(ratingsData.avg_communication) || 0,
          shipping: parseFloat(ratingsData.avg_shipping) || 0,
          itemAuthenticity: parseFloat(ratingsData.avg_item_authenticity) || 0,
          overall: parseFloat(ratingsData.avg_overall) || 0,
        },
        totalReviews: ratingsData.total_reviews,
        distribution: {
          fiveStar: ratingsData.five_star_count,
          fourStar: ratingsData.four_star_count,
          threeStar: ratingsData.three_star_count,
          twoStar: ratingsData.two_star_count,
          oneStar: ratingsData.one_star_count,
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching seller ratings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch seller ratings',
      error: error.message,
    });
  }
});

// =============================================
// GET SELLER REVIEWS (with pagination)
// =============================================

router.get('/seller/:sellerId', async (req: Request, res: Response) => {
  try {
    const { sellerId } = req.params;
    const {
      page = '1',
      limit = '10',
      sortBy = 'created_at',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 50);
    const offset = (pageNum - 1) * limitNum;

    // Validate sort options
    const validSortFields = ['created_at', 'overall_rating'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'created_at';
    const ascending = sortOrder === 'asc';

    // Get total count
    const { count } = await supabase
      .from('seller_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('seller_id', sellerId)
      .eq('is_visible', true);

    // Get reviews with buyer info
    const { data: reviews, error } = await supabase
      .from('seller_reviews')
      .select(`
        review_id,
        seller_id,
        buyer_id,
        order_id,
        communication_rating,
        shipping_rating,
        item_authenticity_rating,
        overall_rating,
        review_text,
        created_at,
        updated_at
      `)
      .eq('seller_id', sellerId)
      .eq('is_visible', true)
      .order(sortField as string, { ascending })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    // Get buyer info separately
    const buyerIds = [...new Set(reviews?.map(r => r.buyer_id) || [])];
    let buyersMap: Record<string, any> = {};
    
    if (buyerIds.length > 0) {
      const { data: buyers } = await supabase
        .from('users')
        .select('user_id, name, profile_picture')
        .in('user_id', buyerIds);
      
      buyers?.forEach(buyer => {
        buyersMap[buyer.user_id] = buyer;
      });
    }

    // Get replies for each review
    const reviewIds = reviews?.map(r => r.review_id) || [];
    
    let replies: any[] = [];
    let sellersMap: Record<string, any> = {};
    
    if (reviewIds.length > 0) {
      const { data: repliesData } = await supabase
        .from('review_replies')
        .select('reply_id, review_id, seller_id, reply_text, created_at')
        .in('review_id', reviewIds)
        .order('created_at', { ascending: true });

      replies = repliesData || [];
      
      // Get seller info for replies
      const sellerIds = [...new Set(replies.map(r => r.seller_id))];
      if (sellerIds.length > 0) {
        const { data: sellers } = await supabase
          .from('users')
          .select('user_id, name, profile_picture')
          .in('user_id', sellerIds);
        
        // Also get seller profiles for store info
        const { data: sellerProfiles } = await supabase
          .from('seller_profiles')
          .select('user_id, store_name, store_logo')
          .in('user_id', sellerIds);
        
        sellers?.forEach(seller => {
          const profile = sellerProfiles?.find(p => p.user_id === seller.user_id);
          sellersMap[seller.user_id] = {
            ...seller,
            store_name: profile?.store_name,
            store_logo: profile?.store_logo,
          };
        });
      }
    }

    // Format reviews with replies
    const formattedReviews = reviews?.map(review => {
      const reviewReplies = replies.filter(r => r.review_id === review.review_id);
      const buyer = buyersMap[review.buyer_id];
      
      return {
        id: review.review_id,
        sellerId: review.seller_id,
        buyerId: review.buyer_id,
        orderId: review.order_id,
        ratings: {
          communication: review.communication_rating,
          shipping: review.shipping_rating,
          itemAuthenticity: review.item_authenticity_rating,
          overall: parseFloat(review.overall_rating as any) || 0,
        },
        reviewText: review.review_text,
        createdAt: review.created_at,
        updatedAt: review.updated_at,
        buyer: {
          id: buyer?.user_id,
          name: buyer?.name || 'Anonymous',
          avatar: buyer?.profile_picture || '/assets/user.png',
        },
        replies: reviewReplies.map(reply => {
          const seller = sellersMap[reply.seller_id];
          return {
            id: reply.reply_id,
            text: reply.reply_text,
            createdAt: reply.created_at,
            seller: {
              id: seller?.user_id,
              name: seller?.store_name || seller?.name || 'Seller',
              avatar: seller?.store_logo || seller?.profile_picture || '/assets/user.png',
            },
          };
        }),
      };
    }) || [];

    res.json({
      success: true,
      data: formattedReviews,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Error fetching seller reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch seller reviews',
      error: error.message,
    });
  }
});

// =============================================
// CREATE REVIEW (Buyer only)
// =============================================

router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const {
      sellerId,
      orderId,
      communicationRating,
      shippingRating,
      itemAuthenticityRating,
      reviewText,
    }: CreateReviewBody = req.body;

    // Validation
    if (!sellerId) {
      return res.status(400).json({
        success: false,
        message: 'Seller ID is required',
      });
    }

    // Validate ratings (1-5)
    const ratings = [communicationRating, shippingRating, itemAuthenticityRating];
    for (const rating of ratings) {
      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          message: 'All ratings must be between 1 and 5',
        });
      }
    }

    // Prevent self-review
    if (userId === sellerId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot review yourself',
      });
    }

    // Check if user already reviewed this seller (for this order if provided)
    const existingQuery = supabase
      .from('seller_reviews')
      .select('review_id')
      .eq('seller_id', sellerId)
      .eq('buyer_id', userId);

    if (orderId) {
      existingQuery.eq('order_id', orderId);
    }

    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        message: orderId 
          ? 'You have already reviewed this seller for this order' 
          : 'You have already reviewed this seller',
      });
    }

    // If orderId provided, verify the order exists and belongs to this buyer
    if (orderId) {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('order_id, buyer_id, seller_id, status')
        .eq('order_id', orderId)
        .single();

      if (orderError || !order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found',
        });
      }

      if (order.buyer_id !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You can only review orders you placed',
        });
      }

      if (order.seller_id !== sellerId) {
        return res.status(400).json({
          success: false,
          message: 'Seller does not match the order',
        });
      }
    }

    // Create review
    const { data: review, error } = await supabase
      .from('seller_reviews')
      .insert({
        seller_id: sellerId,
        buyer_id: userId,
        order_id: orderId || null,
        communication_rating: communicationRating,
        shipping_rating: shippingRating,
        item_authenticity_rating: itemAuthenticityRating,
        review_text: reviewText?.trim() || null,
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: {
        id: review.review_id,
        sellerId: review.seller_id,
        ratings: {
          communication: review.communication_rating,
          shipping: review.shipping_rating,
          itemAuthenticity: review.item_authenticity_rating,
          overall: review.overall_rating,
        },
        reviewText: review.review_text,
        createdAt: review.created_at,
      },
    });
  } catch (error: any) {
    console.error('Error creating review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create review',
      error: error.message,
    });
  }
});

// =============================================
// UPDATE REVIEW (Buyer only - own review)
// =============================================

router.patch('/:reviewId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { reviewId } = req.params;
    const {
      communicationRating,
      shippingRating,
      itemAuthenticityRating,
      reviewText,
    }: UpdateReviewBody = req.body;

    // Check ownership
    const { data: existing, error: fetchError } = await supabase
      .from('seller_reviews')
      .select('review_id, buyer_id')
      .eq('review_id', reviewId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    if (existing.buyer_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own reviews',
      });
    }

    // Build update object
    const updates: any = {};
    
    if (communicationRating !== undefined) {
      if (communicationRating < 1 || communicationRating > 5) {
        return res.status(400).json({
          success: false,
          message: 'Rating must be between 1 and 5',
        });
      }
      updates.communication_rating = communicationRating;
    }
    
    if (shippingRating !== undefined) {
      if (shippingRating < 1 || shippingRating > 5) {
        return res.status(400).json({
          success: false,
          message: 'Rating must be between 1 and 5',
        });
      }
      updates.shipping_rating = shippingRating;
    }
    
    if (itemAuthenticityRating !== undefined) {
      if (itemAuthenticityRating < 1 || itemAuthenticityRating > 5) {
        return res.status(400).json({
          success: false,
          message: 'Rating must be between 1 and 5',
        });
      }
      updates.item_authenticity_rating = itemAuthenticityRating;
    }
    
    if (reviewText !== undefined) {
      updates.review_text = reviewText.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update',
      });
    }

    // Update review
    const { data: review, error } = await supabase
      .from('seller_reviews')
      .update(updates)
      .eq('review_id', reviewId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: {
        id: review.review_id,
        ratings: {
          communication: review.communication_rating,
          shipping: review.shipping_rating,
          itemAuthenticity: review.item_authenticity_rating,
          overall: review.overall_rating,
        },
        reviewText: review.review_text,
        updatedAt: review.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Error updating review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update review',
      error: error.message,
    });
  }
});

// =============================================
// DELETE REVIEW (Buyer only - own review)
// =============================================

router.delete('/:reviewId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { reviewId } = req.params;

    // Check ownership
    const { data: existing, error: fetchError } = await supabase
      .from('seller_reviews')
      .select('review_id, buyer_id')
      .eq('review_id', reviewId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    if (existing.buyer_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own reviews',
      });
    }

    // Delete review (replies will cascade)
    const { error } = await supabase
      .from('seller_reviews')
      .delete()
      .eq('review_id', reviewId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Review deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete review',
      error: error.message,
    });
  }
});

// =============================================
// ADD REPLY (Seller only - to their reviews)
// =============================================

router.post('/:reviewId/reply', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { reviewId } = req.params;
    const { replyText }: CreateReplyBody = req.body;

    if (!replyText?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reply text is required',
      });
    }

    // Check if review exists and belongs to this seller
    const { data: review, error: fetchError } = await supabase
      .from('seller_reviews')
      .select('review_id, seller_id')
      .eq('review_id', reviewId)
      .single();

    if (fetchError || !review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found',
      });
    }

    if (review.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only reply to reviews about your store',
      });
    }

    // Check if seller already replied
    const { data: existingReply } = await supabase
      .from('review_replies')
      .select('reply_id')
      .eq('review_id', reviewId)
      .eq('seller_id', userId)
      .maybeSingle();

    if (existingReply) {
      return res.status(400).json({
        success: false,
        message: 'You have already replied to this review',
      });
    }

    // Create reply
    const { data: reply, error } = await supabase
      .from('review_replies')
      .insert({
        review_id: reviewId,
        seller_id: userId,
        reply_text: replyText.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: 'Reply added successfully',
      data: {
        id: reply.reply_id,
        reviewId: reply.review_id,
        text: reply.reply_text,
        createdAt: reply.created_at,
      },
    });
  } catch (error: any) {
    console.error('Error adding reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reply',
      error: error.message,
    });
  }
});

// =============================================
// UPDATE REPLY (Seller only - own reply)
// =============================================

router.patch('/reply/:replyId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { replyId } = req.params;
    const { replyText }: CreateReplyBody = req.body;

    if (!replyText?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reply text is required',
      });
    }

    // Check ownership
    const { data: existing, error: fetchError } = await supabase
      .from('review_replies')
      .select('reply_id, seller_id')
      .eq('reply_id', replyId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found',
      });
    }

    if (existing.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own replies',
      });
    }

    // Update reply
    const { data: reply, error } = await supabase
      .from('review_replies')
      .update({ reply_text: replyText.trim() })
      .eq('reply_id', replyId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: 'Reply updated successfully',
      data: {
        id: reply.reply_id,
        text: reply.reply_text,
        updatedAt: reply.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Error updating reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update reply',
      error: error.message,
    });
  }
});

// =============================================
// DELETE REPLY (Seller only - own reply)
// =============================================

router.delete('/reply/:replyId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { replyId } = req.params;

    // Check ownership
    const { data: existing, error: fetchError } = await supabase
      .from('review_replies')
      .select('reply_id, seller_id')
      .eq('reply_id', replyId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found',
      });
    }

    if (existing.seller_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own replies',
      });
    }

    // Delete reply
    const { error } = await supabase
      .from('review_replies')
      .delete()
      .eq('reply_id', replyId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'Reply deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete reply',
      error: error.message,
    });
  }
});

// =============================================
// GET MY REVIEWS (Buyer's reviews they've written)
// =============================================

router.get('/my-reviews', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 50);
    const offset = (pageNum - 1) * limitNum;

    // Get total count
    const { count } = await supabase
      .from('seller_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('buyer_id', userId);

    // Get reviews
    const { data: reviews, error } = await supabase
      .from('seller_reviews')
      .select(`
        review_id,
        seller_id,
        order_id,
        communication_rating,
        shipping_rating,
        item_authenticity_rating,
        overall_rating,
        review_text,
        created_at
      `)
      .eq('buyer_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (error) throw error;

    // Get seller info
    const sellerIds = [...new Set(reviews?.map(r => r.seller_id) || [])];
    let sellersMap: Record<string, any> = {};
    
    if (sellerIds.length > 0) {
      const { data: sellers } = await supabase
        .from('users')
        .select('user_id, name, profile_picture')
        .in('user_id', sellerIds);
      
      const { data: sellerProfiles } = await supabase
        .from('seller_profiles')
        .select('user_id, store_name, store_logo')
        .in('user_id', sellerIds);
      
      sellers?.forEach(seller => {
        const profile = sellerProfiles?.find(p => p.user_id === seller.user_id);
        sellersMap[seller.user_id] = {
          ...seller,
          store_name: profile?.store_name,
          store_logo: profile?.store_logo,
        };
      });
    }

    const formattedReviews = reviews?.map(review => {
      const seller = sellersMap[review.seller_id];
      
      return {
        id: review.review_id,
        sellerId: review.seller_id,
        orderId: review.order_id,
        ratings: {
          communication: review.communication_rating,
          shipping: review.shipping_rating,
          itemAuthenticity: review.item_authenticity_rating,
          overall: parseFloat(review.overall_rating as any) || 0,
        },
        reviewText: review.review_text,
        createdAt: review.created_at,
        seller: {
          id: seller?.user_id,
          name: seller?.store_name || seller?.name || 'Seller',
          avatar: seller?.store_logo || seller?.profile_picture || '/assets/user.png',
        },
      };
    }) || [];

    res.json({
      success: true,
      data: formattedReviews,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Error fetching my reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews',
      error: error.message,
    });
  }
});

export default router;