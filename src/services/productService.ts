// src/services/productService.ts
import { supabaseAdmin as supabase } from "../config/supabase";
import { OCRService } from "./ocrService";

export class ProductService {
  private ocrService: OCRService;

  constructor() {
    this.ocrService = new OCRService();
  }
  async createProduct(data: any) {
    try {
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

      // 4. Prepare product data
      const productData = {
        seller_id: data.sellerId,
        category_id: category.category_id,
        name: data.productDetails.title,
        slug,
        description: data.productDetails.description || "",
        short_description: (data.productDetails.description || "").substring(
          0,
          200
        ),
        price: data.productDetails.price,
        original_price: data.productDetails.price,
        currency: "NGN",
        negotiable: data.additionalInfo.openToNegotiation === "yes",
        type: category.is_service ? "service" : "product",

        // Location
        location_state: data.productCore.state,
        location_city: data.productCore.lga,

        // Stock
        stock_quantity: data.additionalInfo.productStock,
        min_order_quantity: 1,

        // Delivery
        shipping_available: delivery.shipping_available,
        pickup_available: delivery.pickup_available,

        // Metadata (category-specific fields)
        metadata: {
          categoryKey: data.productCore.category,
          subcategoryKey: data.productCore.subcategory,
          specifications: data.productDetails.specifications || {},
        },

        // Verification
        verification_required: true,
        verification_status: "pending",
        receipt_verified: false,

        // Status
        status: "active",
        featured: false,

        // Initialize counts
        views_count: 0,
        favorites_count: 0,
        rating_average: 0,
        rating_count: 0,
      };

      // 5. Insert product
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

      // 6. Save images
      let images: any[] = [];
      if (data.productCore.imageUrls && data.productCore.imageUrls.length > 0) {
        images = await this.saveImages(
          product.product_id,
          data.productCore.imageUrls
        );
      }

      // // 7. Create verification record
      // let verification = null;
      // if (data.verification?.videoFile || data.verification?.receiptFile) {
      //   verification = await this.createVerification(product.product_id, data.verification);

      //   // If receipt was auto-verified, update product status
      //   if (verification.status === 'approved') {
      //     await supabase
      //       .from('products')
      //       .update({
      //         verification_status: 'verified',
      //         receipt_verified: true,
      //         status: 'active' // Automatically publish if verified
      //       })
      //       .eq('product_id', product.product_id);

      //     console.log('✅ Product auto-verified and published!');
      //   }
      // }

      // return { product, images, verification };
      let verification = null;

      console.log("✅ Product creation complete!");
      return { product, images, verification };
    } catch (error: any) {
      console.error("ProductService error:", error);
      throw error;
    }
  }

  private async saveImages(productId: string, urls: string[]) {
    const records = urls.map((url, index) => ({
      product_id: productId,
      image_url: url,
      display_order: index,
      is_primary: index === 0,
    }));

    console.log("📸 Saving images for product:", productId);
    console.log("📸 Image records:", JSON.stringify(records, null, 2));

    const { data, error } = await supabase
      .from("product_images")
      .insert(records)
      .select();

    if (error) {
      console.error("❌ Image save error:", error); // This will show the actual error
      throw new Error("Failed to save images");
    }

    console.log("✅ Images saved:", data);
    return data || [];
  }

  private async createVerification(productId: string, files: any) {
    let ocrResult = null;
    let verificationStatus = "pending";

    // If receipt uploaded, run OCR verification
    if (files.receiptFile) {
      console.log("🔍 Running OCR on receipt...");
      try {
        ocrResult = await this.ocrService.verifyReceipt(files.receiptFile);

        // Auto-approve if confidence is high
        if (ocrResult.isValid && ocrResult.confidence > 0.7) {
          verificationStatus = "approved";
          console.log(
            "✅ Receipt auto-verified! Confidence:",
            ocrResult.confidence
          );
        } else {
          console.log(
            "⚠️ Receipt needs manual review. Confidence:",
            ocrResult.confidence
          );
        }
      } catch (error) {
        console.error("❌ OCR failed:", error);
        // Continue without OCR if it fails
      }
    }

    const { data, error } = await supabase
      .from("product_verifications")
      .insert({
        product_id: productId,
        verification_type: files.videoFile ? "ai_video" : "receipt",
        video_url: files.videoFile || null,
        receipt_url: files.receiptFile || null,
        ai_response: ocrResult
          ? {
              rawText: ocrResult.rawText,
              extractedData: ocrResult.extractedData,
              confidence: ocrResult.confidence,
            }
          : null,
        ai_confidence_score: ocrResult?.confidence || null,
        status: verificationStatus,
      })
      .select()
      .single();

    if (error) throw new Error("Failed to create verification");
    return data;
  }

  private generateSlug(title: string): string {
    const base = title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    return `${base}-${Date.now().toString(36)}`;
  }

  private parseDelivery(option: string) {
    const normalized = option.toLowerCase();
    return {
      shipping_available: normalized.includes("delivery"),
      pickup_available: normalized.includes("pickup"),
    };
  }

  async getProductById(productId: string) {
    const { data, error } = await supabase
      .from("products")
      .select(
        `
      *,
      categories(name, slug, type),
      product_images(image_url, is_primary, display_order),
      seller:users!seller_id(user_id, name, profile_picture, trust_score, kyc_status, created_at)
    `
      )
      .eq("product_id", productId)
      .single();

    if (error) throw error;
    return data;
  }

  async getProducts(filters: any = {}) {
    let query = supabase
      .from("products")
      .select(
        `
        *,
        categories(name, slug),
        product_images(image_url, is_primary)
      `,
        { count: "exact" }
      )
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (filters.category) {
      query = query.eq("categories.slug", filters.category);
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
}
