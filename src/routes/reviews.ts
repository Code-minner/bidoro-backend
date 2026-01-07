// backend/src/routes/reviews.ts
import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { supabaseAdmin as supabase } from '../config/supabase';

const router = express.Router();

// Type for rating data
interface RatingData {
  communication_rating: number;
  shipping_rating: number;
  authenticity_rating: number;
}

// Helper function to calculate averages
function calculateAverages(data: RatingData[]) {
  if (!data || data.length === 0) {
    return {
      communication: 0,
      shipping: 0,
      authenticity: 0,
      overall: 0,
      totalReviews: 0,
    };
  }

  const total = data.length;
  const commSum = data.reduce((sum, r) => sum + (r.communication_rating || 0), 0);
  const shipSum = data.reduce((sum, r) => sum + (r.shipping_rating || 0), 0);
  const authSum = data.reduce((sum, r) => sum + (r.authenticity_rating || 0), 0);

  return {
    communication: commSum / total,
    shipping: shipSum / total,
    authenticity: authSum / total,
    overall: (commSum + shipSum + authSum) / (total * 3),
    totalReviews: total,
  };
}

/**
 * GET /api/v1/reviews/product/:productId
 * Get all reviews for a specific product
 */
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    // Get reviews with reviewer info (including email)
    const { data: reviews, error, count } = await supabase
      .from('reviews')
      .select(`
        *,
        reviewer:users!reviews_reviewer_id_fkey(
          user_id,
          name,
          email,
          profile_picture
        )
      `, { count: 'exact' })
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Reviews fetch error:', error);
      throw error;
    }

    // Calculate average ratings
    const { data: avgData } = await supabase
      .from('reviews')
      .select('communication_rating, shipping_rating, authenticity_rating')
      .eq('product_id', productId);

    const averages = calculateAverages(avgData as RatingData[] || []);

    res.json({
      success: true,
      data: reviews || [],
      averages,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error: any) {
    console.error('❌ Reviews fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

/**
 * GET /api/v1/reviews/seller/:sellerId
 * Get all reviews for a seller (across all their products)
 * PUBLIC - anyone can see seller reviews
 */
router.get('/seller/:sellerId', async (req, res) => {
  try {
    const { sellerId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    // Query reviews where the seller_id matches OR where reviewed_user_id matches
    const { data: reviews, error, count } = await supabase
      .from('reviews')
      .select(`
        *,
        reviewer:users!reviews_reviewer_id_fkey(
          user_id,
          name,
          email,
          profile_picture
        )
      `, { count: 'exact' })
      .or(`seller_id.eq.${sellerId},reviewed_user_id.eq.${sellerId}`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Seller reviews fetch error:', error);
      throw error;
    }

    // Calculate average ratings for seller
    const { data: avgData } = await supabase
      .from('reviews')
      .select('communication_rating, shipping_rating, authenticity_rating')
      .or(`seller_id.eq.${sellerId},reviewed_user_id.eq.${sellerId}`);

    const averages = calculateAverages(avgData as RatingData[] || []);

    res.json({
      success: true,
      data: reviews || [],
      averages,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error: any) {
    console.error('❌ Seller reviews fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch seller reviews'
    });
  }
});

/**
 * POST /api/v1/reviews
 * Create a new review (requires authentication)
 */
router.post('/', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const reviewerId = req.user!.id;
    const {
      product_id,
      seller_id,
      communication_rating,
      shipping_rating,
      authenticity_rating,
      comment
    } = req.body;

    // Validate required fields
    if (!product_id || !seller_id) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and Seller ID are required'
      });
    }

    // Validate ratings (1-5)
    if (
      !communication_rating || communication_rating < 1 || communication_rating > 5 ||
      !shipping_rating || shipping_rating < 1 || shipping_rating > 5 ||
      !authenticity_rating || authenticity_rating < 1 || authenticity_rating > 5
    ) {
      return res.status(400).json({
        success: false,
        message: 'All ratings must be between 1 and 5'
      });
    }

    // Check if user already reviewed this product
    const { data: existingReview } = await supabase
      .from('reviews')
      .select('review_id')
      .eq('product_id', product_id)
      .eq('reviewer_id', reviewerId)
      .single();

    if (existingReview) {
      return res.status(400).json({
        success: false,
        message: 'You have already reviewed this product'
      });
    }

    // Create the review
    const { data: review, error } = await supabase
      .from('reviews')
      .insert({
        product_id,
        seller_id,
        reviewed_user_id: seller_id, // For backwards compatibility with old schema
        reviewer_id: reviewerId,
        communication_rating,
        shipping_rating,
        authenticity_rating,
        rating: Math.round((communication_rating + shipping_rating + authenticity_rating) / 3), // Average for old schema
        comment: comment || null
      })
      .select(`
        *,
        reviewer:users!reviews_reviewer_id_fkey(
          user_id,
          name,
          email,
          profile_picture
        )
      `)
      .single();

    if (error) {
      console.error('Review creation error:', error);
      throw error;
    }

    // Update seller's average rating
    await updateSellerRating(seller_id);

    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: review
    });

  } catch (error: any) {
    console.error('❌ Review creation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to submit review'
    });
  }
});

/**
 * PUT /api/v1/reviews/:reviewId
 * Update an existing review (only by the reviewer)
 */
router.put('/:reviewId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const reviewerId = req.user!.id;
    const { reviewId } = req.params;
    const {
      communication_rating,
      shipping_rating,
      authenticity_rating,
      comment
    } = req.body;

    // Check if review exists and belongs to user
    const { data: existingReview } = await supabase
      .from('reviews')
      .select('review_id, reviewer_id, seller_id')
      .eq('review_id', reviewId)
      .single();

    if (!existingReview) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    if (existingReview.reviewer_id !== reviewerId) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own reviews'
      });
    }

    // Build update object
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    };
    
    if (communication_rating) updateData.communication_rating = communication_rating;
    if (shipping_rating) updateData.shipping_rating = shipping_rating;
    if (authenticity_rating) updateData.authenticity_rating = authenticity_rating;
    if (comment !== undefined) updateData.comment = comment;

    const { data: review, error } = await supabase
      .from('reviews')
      .update(updateData)
      .eq('review_id', reviewId)
      .select(`
        *,
        reviewer:users!reviews_reviewer_id_fkey(
          user_id,
          name,
          email,
          profile_picture
        )
      `)
      .single();

    if (error) {
      throw error;
    }

    // Update seller's average rating
    await updateSellerRating(existingReview.seller_id);

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: review
    });

  } catch (error: any) {
    console.error('❌ Review update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update review'
    });
  }
});

/**
 * DELETE /api/v1/reviews/:reviewId
 * Delete a review (only by the reviewer)
 */
router.delete('/:reviewId', authenticateToken, async (req: AuthRequest, res) => {
  try {
    const reviewerId = req.user!.id;
    const { reviewId } = req.params;

    // Check if review exists and belongs to user
    const { data: existingReview } = await supabase
      .from('reviews')
      .select('review_id, reviewer_id, seller_id')
      .eq('review_id', reviewId)
      .single();

    if (!existingReview) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    if (existingReview.reviewer_id !== reviewerId) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own reviews'
      });
    }

    // Delete the review
    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('review_id', reviewId);

    if (error) {
      throw error;
    }

    // Update seller's average rating
    await updateSellerRating(existingReview.seller_id);

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });

  } catch (error: any) {
    console.error('❌ Review delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete review'
    });
  }
});

/**
 * Helper: Update seller's cached average rating
 */
async function updateSellerRating(sellerId: string) {
  try {
    const { data: reviews } = await supabase
      .from('reviews')
      .select('communication_rating, shipping_rating, authenticity_rating')
      .eq('seller_id', sellerId);

    if (reviews && reviews.length > 0) {
      const ratingData = reviews as RatingData[];
      const total = ratingData.length;
      const commAvg = ratingData.reduce((sum, r) => sum + r.communication_rating, 0) / total;
      const shipAvg = ratingData.reduce((sum, r) => sum + r.shipping_rating, 0) / total;
      const authAvg = ratingData.reduce((sum, r) => sum + r.authenticity_rating, 0) / total;
      const overallAvg = (commAvg + shipAvg + authAvg) / 3;

      // Update user's trust_score (converts 5-star to 100 scale)
      await supabase
        .from('users')
        .update({
          trust_score: Math.round(overallAvg * 20),
        })
        .eq('user_id', sellerId);
    }
  } catch (error) {
    console.error('Failed to update seller rating:', error);
  }
}

export default router;