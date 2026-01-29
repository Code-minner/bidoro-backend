// src/services/receiptScannerService.ts
// Receipt verification service - Uses your existing OCRService

import { OCRService } from '../services/ocrService';
import { supabaseAdmin as supabase } from '../config/database';

const ocrService = new OCRService();

// ============================================================
// TYPES
// ============================================================

export interface ReceiptVerificationResult {
  isValid: boolean;
  matchScore: number;
  priceMatch: boolean;
  productMatch: boolean;
  dateValid: boolean;
  issues: string[];
  extractedData: {
    storeName: string | null;
    purchaseDate: string | null;
    totalAmount: number | null;
    items: string[];
    receiptNumber: string | null;
    rawText: string;
    confidence: number;
  };
  autoApproved: boolean;
}

export interface ProductData {
  productId: string;
  name: string;
  price: number;
  category?: string;
}

// ============================================================
// RECEIPT SCANNER SERVICE
// ============================================================

class ReceiptScannerService {
  
  /**
   * Process receipt and verify against product
   * This is the main method called by the admin route
   */
  async processReceipt(
    receiptImageUrl: string,
    productData: ProductData
  ): Promise<{
    success: boolean;
    verification: ReceiptVerificationResult;
    autoApproved: boolean;
  }> {
    try {
      console.log('🔍 Starting receipt verification for:', productData.name);
      
      // Use your existing OCR service
      const ocrResult = await ocrService.verifyReceipt(receiptImageUrl);
      
      if (!ocrResult.isValid) {
        const failedResult: ReceiptVerificationResult = {
          isValid: false,
          matchScore: 0,
          priceMatch: false,
          productMatch: false,
          dateValid: false,
          issues: [ocrResult.error || 'Could not read receipt'],
          extractedData: {
            storeName: null,
            purchaseDate: null,
            totalAmount: null,
            items: [],
            receiptNumber: null,
            rawText: ocrResult.rawText || '',
            confidence: ocrResult.confidence || 0
          },
          autoApproved: false
        };
        
        return {
          success: false,
          verification: failedResult,
          autoApproved: false
        };
      }

      // Verify the receipt against product data
      const verification = await this.verifyReceiptAgainstProduct(
        ocrResult,
        productData
      );

      // Save verification result to database
      await this.saveVerificationResult(productData.productId, verification);

      return {
        success: true,
        verification,
        autoApproved: verification.autoApproved
      };

    } catch (error: any) {
      console.error('❌ Receipt processing error:', error);
      return {
        success: false,
        verification: {
          isValid: false,
          matchScore: 0,
          priceMatch: false,
          productMatch: false,
          dateValid: false,
          issues: [error.message || 'Verification failed'],
          extractedData: {
            storeName: null,
            purchaseDate: null,
            totalAmount: null,
            items: [],
            receiptNumber: null,
            rawText: '',
            confidence: 0
          },
          autoApproved: false
        },
        autoApproved: false
      };
    }
  }

  /**
   * Verify receipt data against product listing
   */
  private async verifyReceiptAgainstProduct(
    ocrResult: {
      isValid: boolean;
      confidence: number;
      extractedData: {
        storeName?: string;
        date?: string;
        totalAmount?: number;
        items?: string[];
        receiptNumber?: string;
      };
      rawText: string;
    },
    productData: ProductData
  ): Promise<ReceiptVerificationResult> {
    const issues: string[] = [];
    let matchScore = 0;

    const { extractedData, confidence, rawText } = ocrResult;

    // 1. Check price match (with 15% tolerance for taxes/fees)
    let priceMatch = false;
    if (extractedData.totalAmount) {
      const priceDiff = Math.abs(extractedData.totalAmount - productData.price);
      const tolerance = productData.price * 0.15;
      priceMatch = priceDiff <= tolerance;
      
      if (priceMatch) {
        matchScore += 35;
        console.log('✅ Price match!', extractedData.totalAmount, '~=', productData.price);
      } else {
        issues.push(`Price mismatch: Receipt shows ₦${extractedData.totalAmount?.toLocaleString()}, listing is ₦${productData.price.toLocaleString()}`);
        console.log('❌ Price mismatch:', extractedData.totalAmount, '!=', productData.price);
      }
    } else {
      issues.push('Could not extract total amount from receipt');
    }

    // 2. Check product name match
    let productMatch = false;
    const productNameLower = productData.name.toLowerCase();
    const productWords = productNameLower.split(/\s+/).filter(w => w.length > 2);
    const rawTextLower = rawText.toLowerCase();
    
    // Check in receipt items first
    if (extractedData.items && extractedData.items.length > 0) {
      for (const item of extractedData.items) {
        const itemLower = item.toLowerCase();
        const matchingWords = productWords.filter(word => itemLower.includes(word));
        if (matchingWords.length >= Math.ceil(productWords.length * 0.5)) {
          productMatch = true;
          matchScore += 35;
          console.log('✅ Product found in items:', item);
          break;
        }
      }
    }
    
    // Fallback: check raw text
    if (!productMatch) {
      const matchingWords = productWords.filter(word => rawTextLower.includes(word));
      if (matchingWords.length >= Math.ceil(productWords.length * 0.4)) {
        productMatch = true;
        matchScore += 25; // Lower score for raw text match
        console.log('✅ Product found in raw text');
      } else {
        issues.push(`Product name "${productData.name}" not clearly found on receipt`);
        console.log('❌ Product not found. Matched words:', matchingWords);
      }
    }

    // 3. Check date validity (within last 365 days)
    let dateValid = false;
    if (extractedData.date) {
      try {
        const receiptDate = this.parseDate(extractedData.date);
        if (receiptDate) {
          const now = new Date();
          const daysDiff = Math.floor((now.getTime() - receiptDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysDiff >= 0 && daysDiff <= 365) {
            dateValid = true;
            matchScore += 20;
            console.log('✅ Date valid:', extractedData.date, `(${daysDiff} days ago)`);
          } else if (daysDiff < 0) {
            issues.push('Receipt date is in the future');
          } else {
            issues.push(`Receipt is ${daysDiff} days old (over 1 year)`);
          }
        }
      } catch {
        issues.push('Could not parse receipt date');
      }
    } else {
      issues.push('Could not find purchase date on receipt');
    }

    // 4. Receipt quality/confidence bonus
    if (confidence >= 0.7) {
      matchScore += 10;
    }

    // Determine if valid and auto-approved
    const isValid = matchScore >= 60 && issues.length <= 2;
    const autoApproved = matchScore >= 80 && issues.length === 0;

    console.log('📊 Verification complete:', { matchScore, isValid, autoApproved, issues });

    return {
      isValid,
      matchScore,
      priceMatch,
      productMatch,
      dateValid,
      issues,
      extractedData: {
        storeName: extractedData.storeName || null,
        purchaseDate: extractedData.date || null,
        totalAmount: extractedData.totalAmount || null,
        items: extractedData.items || [],
        receiptNumber: extractedData.receiptNumber || null,
        rawText,
        confidence
      },
      autoApproved
    };
  }

  /**
   * Parse various date formats
   */
  private parseDate(dateStr: string): Date | null {
    // Common date formats
    const formats = [
      /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/, // DD/MM/YYYY or MM/DD/YYYY
      /(\d{1,2})[-\/](\d{1,2})[-\/](\d{2})/, // DD/MM/YY
      /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/, // YYYY-MM-DD
    ];

    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        const parts = match.slice(1).map(Number);
        if (parts[2] < 100) parts[2] += 2000; // Convert 2-digit year
        
        // Try DD/MM/YYYY (common in Nigeria)
        let date = new Date(parts[2], parts[1] - 1, parts[0]);
        if (!isNaN(date.getTime())) return date;
        
        // Try MM/DD/YYYY
        date = new Date(parts[2], parts[0] - 1, parts[1]);
        if (!isNaN(date.getTime())) return date;
      }
    }

    // Try native Date parsing as fallback
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * Save verification result to database
   */
  private async saveVerificationResult(
    productId: string,
    result: ReceiptVerificationResult
  ): Promise<void> {
    try {
      // Check if product_verifications table exists
      const { error: checkError } = await supabase
        .from('product_verifications')
        .select('verification_id')
        .limit(1);

      // If table doesn't exist, just log and continue
      if (checkError && checkError.code === '42P01') {
        console.log('⚠️ product_verifications table does not exist. Skipping save.');
        
        // Just update the product directly
        if (result.autoApproved) {
          await supabase
            .from('products')
            .update({
              status: 'active',
              verification_status: 'ai_verified',
              receipt_verified: true,
              updated_at: new Date().toISOString()
            })
            .eq('product_id', productId)
            .eq('status', 'pending');
        }
        return;
      }

      // Upsert verification record
      const { error: verifyError } = await supabase
        .from('product_verifications')
        .upsert({
          product_id: productId,
          verification_type: 'receipt',
          match_score: result.matchScore,
          is_valid: result.isValid,
          auto_approved: result.autoApproved,
          price_match: result.priceMatch,
          product_match: result.productMatch,
          date_valid: result.dateValid,
          issues: result.issues,
          extracted_data: result.extractedData,
          verified_at: new Date().toISOString()
        }, {
          onConflict: 'product_id,verification_type'
        });

      if (verifyError) {
        console.error('Failed to save verification:', verifyError);
      }

      // Auto-approve product if eligible
      if (result.autoApproved) {
        const { error: updateError } = await supabase
          .from('products')
          .update({
            status: 'active',
            verification_status: 'ai_verified',
            receipt_verified: true,
            updated_at: new Date().toISOString()
          })
          .eq('product_id', productId)
          .eq('status', 'pending');

        if (!updateError) {
          console.log('✅ Product auto-approved:', productId);
        }
      }
    } catch (error) {
      console.error('Failed to save verification result:', error);
    }
  }
}

// Export singleton instance
export const receiptScanner = new ReceiptScannerService();

// Also export the class for testing
export { ReceiptScannerService };