// src/services/productService.ts
// Updated with AI verification and auto-approval logic
import { supabaseAdmin as supabase } from "../config/supabase";
import { OCRService } from "./ocrService";

export class ProductService {
  private ocrService: OCRService;

  constructor() {
    this.ocrService = new OCRService();
  }

  /**
   * Create a new product with optional AI verification
   * 
   * Flow:
   * 1. If receipt uploaded → Run AI verification
   *    - If AI passes (80%+ confidence) → Auto-approve (status: active)
   *    - If AI fails → Set to pending (admin reviews)
   * 2. If NO receipt uploaded → Set to pending (admin reviews manually)
   */
  async createProduct(data: any) {
    try {
      console.log("🚀 Starting product creation...");
      console.log("📦 Verification data:", data.verification);

      // 1. Get category_id from category key
      const { data: category, error: categoryError } = await supabase
        .from("categories")
        .select("category_id, is_service")
        .eq("key", data.productCore.subcategory)
        .single();

      if (categoryError || !category) {
        throw new Error("Invalid category");
      }

      // 2. Generate slug
      const slug = this.generateSlug(data.productDetails.title);

      // 3. Parse delivery options
      const delivery = this.parseDelivery(data.additionalInfo.deliveryOption);

      // 4. Extract verification files
      const receiptUrl = data.verification?.receiptUrl || null;
      const videoUrl = data.verification?.videoUrl || null;
      const verificationMethod = data.verification?.verificationMethod || 'manual';

      console.log("📄 Receipt URL:", receiptUrl);
      console.log("🎬 Video URL:", videoUrl);
      console.log("🔍 Verification method:", verificationMethod);

      // 5. Determine initial status and run AI verification if receipt provided
      let productStatus = 'pending';  // Default to pending
      let verificationStatus = 'pending';
      let receiptVerified = false;
      let aiVerificationResult: any = null;

      // Run AI verification if receipt is uploaded
      if (receiptUrl) {
        console.log("🤖 Running AI verification on receipt...");
        
        try {
          aiVerificationResult = await this.runReceiptVerification(
            receiptUrl,
            data.productDetails.title,
            data.productDetails.price
          );

          console.log("🤖 AI Verification result:", aiVerificationResult);

          // Auto-approve if AI verification passes with high confidence
          if (aiVerificationResult.isValid && aiVerificationResult.confidence >= 0.8) {
            productStatus = 'active';
            verificationStatus = 'ai_verified';
            receiptVerified = true;
            console.log("✅ AUTO-APPROVED! High confidence receipt verification");
          } else if (aiVerificationResult.isValid && aiVerificationResult.confidence >= 0.6) {
            // Medium confidence - still pending but flag as partially verified
            productStatus = 'pending';
            verificationStatus = 'pending';
            receiptVerified = false;
            console.log("⚠️ Medium confidence - needs admin review");
          } else {
            // Low confidence or invalid - pending for manual review
            productStatus = 'pending';
            verificationStatus = 'pending';
            receiptVerified = false;
            console.log("❌ Low confidence - needs admin review");
          }
        } catch (ocrError: any) {
          console.error("❌ OCR verification failed:", ocrError.message);
          // Continue with pending status if OCR fails
          productStatus = 'pending';
          verificationStatus = 'pending';
        }
      } else {
        // No receipt uploaded - manual review required
        console.log("📝 No receipt uploaded - manual review required");
        productStatus = 'pending';
        verificationStatus = verificationMethod === 'video' ? 'pending' : 'not_required';
      }

      // 6. Prepare product data
      const productData = {
        seller_id: data.sellerId,
        category_id: category.category_id,
        name: data.productDetails.title,
        slug,
        description: data.productDetails.description || "",
        short_description: (data.productDetails.description || "").substring(0, 200),
        price: data.productDetails.price,
        original_price: data.productDetails.price,
        currency: "NGN",
        negotiable: data.additionalInfo.openToNegotiation === "yes",
        type: category.is_service ? "service" : "product",

        // Location
        location_state: data.productCore.state,
        location_city: data.productCore.lga,

        // Stock
        stock_quantity: data.additionalInfo.productStock || 1,
        min_order_quantity: 1,

        // Delivery
        shipping_available: delivery.shipping_available,
        pickup_available: delivery.pickup_available,

        // Video URL for reels
        video_url: videoUrl,

        // Metadata (category-specific fields + receipt)
        metadata: {
          categoryKey: data.productCore.category,
          subcategoryKey: data.productCore.subcategory,
          specifications: data.productDetails.specifications || {},
          receiptUrl: receiptUrl,  // Store receipt URL in metadata
          verificationMethod: verificationMethod,
          aiVerificationResult: aiVerificationResult,  // Store AI result for reference
        },

        // Verification fields
        verification_required: !receiptVerified,  // Not required if auto-verified
        verification_status: verificationStatus,
        receipt_verified: receiptVerified,

        // Status - IMPORTANT: This determines if product is visible
        status: productStatus,
        featured: false,

        // Initialize counts
        views_count: 0,
        favorites_count: 0,
        rating_average: 0,
        rating_count: 0,
      };

      console.log("📝 Final product status:", productStatus);
      console.log("📝 Verification status:", verificationStatus);

      // 7. Insert product
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert(productData)
        .select()
        .single();

      if (productError) {
        console.error("Product insert error:", productError);
        throw new Error(`Failed to create product: ${productError.message}`);
      }

      console.log("✅ Product created:", product.product_id);
      console.log("📊 Product status:", product.status);

      // 8. Save images
      let images: any[] = [];
      if (data.productCore.imageUrls && data.productCore.imageUrls.length > 0) {
        images = await this.saveImages(product.product_id, data.productCore.imageUrls);
      }

      // 9. Log verification result (optional - for admin tracking)
      if (aiVerificationResult) {
        await this.logVerificationResult(product.product_id, aiVerificationResult, receiptUrl);
      }

      console.log("✅ Product creation complete!");
      
      return { 
        product, 
        images, 
        verification: aiVerificationResult,
        autoApproved: productStatus === 'active'
      };

    } catch (error: any) {
      console.error("ProductService error:", error);
      throw error;
    }
  }

  /**
   * Run receipt verification using OCR
   */
  private async runReceiptVerification(
    receiptUrl: string,
    productName: string,
    productPrice: number
  ): Promise<{
    isValid: boolean;
    confidence: number;
    matches: boolean;
    extractedData: any;
    details: string;
  }> {
    try {
      // Use the OCR service to verify receipt
      const result = await this.ocrService.matchProductWithReceipt(
        productName,
        productPrice,
        receiptUrl
      );

      // Also get detailed verification data
      const verification = await this.ocrService.verifyReceipt(receiptUrl);

      return {
        isValid: verification.isValid,
        confidence: Math.max(result.confidence, verification.confidence),
        matches: result.matches,
        extractedData: verification.extractedData,
        details: result.details
      };

    } catch (error: any) {
      console.error("Receipt verification error:", error);
      return {
        isValid: false,
        confidence: 0,
        matches: false,
        extractedData: {},
        details: `Verification failed: ${error.message}`
      };
    }
  }

  /**
   * Log verification result for admin tracking
   */
  private async logVerificationResult(
    productId: string,
    verificationResult: any,
    receiptUrl: string | null
  ) {
    try {
      // Try to insert into product_verifications table if it exists
      const { error } = await supabase
        .from("product_verifications")
        .insert({
          product_id: productId,
          verification_type: 'receipt',
          receipt_url: receiptUrl,
          match_score: Math.round(verificationResult.confidence * 100),
          is_valid: verificationResult.isValid,
          auto_approved: verificationResult.confidence >= 0.8 && verificationResult.isValid,
          price_match: verificationResult.matches,
          product_match: verificationResult.matches,
          date_valid: true,
          issues: verificationResult.confidence < 0.8 ? ['Low confidence score'] : [],
          extracted_data: verificationResult.extractedData,
          created_at: new Date().toISOString()
        });

      if (error) {
        // Table might not exist - just log it
        console.log("📝 Verification logging skipped (table may not exist):", error.message);
      } else {
        console.log("📝 Verification result logged to database");
      }
    } catch (e) {
      // Silently fail - this is optional logging
      console.log("📝 Verification logging skipped");
    }
  }

  /**
   * Save product images
   */
  private async saveImages(productId: string, urls: string[]) {
    const records = urls.map((url, index) => ({
      product_id: productId,
      image_url: url,
      display_order: index,
      is_primary: index === 0,
    }));

    console.log("📸 Saving images for product:", productId);

    const { data, error } = await supabase
      .from("product_images")
      .insert(records)
      .select();

    if (error) {
      console.error("❌ Image save error:", error);
      throw new Error("Failed to save images");
    }

    console.log("✅ Images saved:", data?.length || 0);
    return data || [];
  }

  /**
   * Generate URL-friendly slug
   */
  private generateSlug(title: string): string {
    const base = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    return `${base}-${Date.now().toString(36)}`;
  }

  /**
   * Parse delivery option string
   */
  private parseDelivery(option: string) {
    const normalized = (option || '').toLowerCase();
    return {
      shipping_available: normalized.includes("delivery"),
      pickup_available: normalized.includes("pickup"),
    };
  }

  /**
   * Get single product by ID
   */
  async getProductById(productId: string) {
    const { data, error } = await supabase
      .from("products")
      .select(`
        *,
        categories(name, slug, type),
        product_images(image_url, is_primary, display_order),
        seller:users!seller_id(user_id, name, profile_picture, trust_score, kyc_status, created_at)
      `)
      .eq("product_id", productId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get products with filters
   */
  async getProducts(filters: any = {}) {
    // If category filter is provided, first get the category_id
    let categoryIds: string[] = [];

    if (filters.category) {
      const { data: category } = await supabase
        .from("categories")
        .select("category_id, parent_id")
        .eq("slug", filters.category)
        .single();

      if (category) {
        categoryIds.push(category.category_id);

        // If this is a parent category, also get all child categories
        if (!category.parent_id) {
          const { data: childCategories } = await supabase
            .from("categories")
            .select("category_id")
            .eq("parent_id", category.category_id);

          if (childCategories && childCategories.length > 0) {
            categoryIds.push(...childCategories.map((c) => c.category_id));
          }
        }
      }
    }

    let query = supabase
      .from("products")
      .select(`
        *,
        categories(name, slug),
        product_images(image_url, is_primary)
      `, { count: "exact" })
      .eq("status", "active")  // Only show active products to public
      .order("created_at", { ascending: false });

    if (categoryIds.length > 0) {
      query = query.in("category_id", categoryIds);
    }
    if (filters.state) {
      query = query.eq("location_state", filters.state);
    }
    if (filters.minPrice) {
      query = query.gte("price", filters.minPrice);
    }
    if (filters.maxPrice) {
      query = query.lte("price", filters.maxPrice);
    }

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const from = (page - 1) * limit;
    query = query.range(from, from + limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      data: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  /**
   * Admin: Manually verify a product
   */
  async adminVerifyProduct(productId: string, adminId: string, action: 'approve' | 'decline', reason?: string) {
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (action === 'approve') {
      updateData.status = 'active';
      updateData.verification_status = 'manual_verified';
      updateData.verification_required = false;
    } else {
      updateData.status = 'declined';
      updateData.verification_status = 'rejected';
    }

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('product_id', productId)
      .select()
      .single();

    if (error) throw error;

    // Log admin action
    try {
      await supabase.from('admin_logs').insert({
        admin_id: adminId,
        action: action === 'approve' ? 'approve_product' : 'decline_product',
        target_type: 'product',
        target_id: productId,
        details: { reason },
        created_at: new Date().toISOString()
      });
    } catch (e) {
      // Admin logs table might not exist
    }

    return data;
  }
}