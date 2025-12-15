// src/services/ocrService.ts
import vision from '@google-cloud/vision';
import path from 'path';

// Initialize Vision API client
const client = new vision.ImageAnnotatorClient({
  keyFilename: path.join(__dirname, '../../google-vision-key.json')
});

export class OCRService {
  /**
   * Extract text from receipt image
   */
  async extractReceiptText(imageUrl: string): Promise<{
    success: boolean;
    text: string;
    data?: any;
    error?: string;
  }> {
    try {
      console.log('🔍 Starting OCR on receipt:', imageUrl);

      // Perform text detection
      const [result] = await client.textDetection(imageUrl);
      const detections = result.textAnnotations;

      if (!detections || detections.length === 0) {
        return {
          success: false,
          text: '',
          error: 'No text found in image'
        };
      }

      // First annotation contains all text
      const fullText = detections[0].description || '';

      console.log('✅ OCR completed. Extracted text length:', fullText.length);

      return {
        success: true,
        text: fullText,
        data: {
          allDetections: detections.map(d => d.description),
          boundingBoxes: detections.map(d => d.boundingPoly)
        }
      };

    } catch (error: any) {
      console.error('❌ OCR Error:', error);
      return {
        success: false,
        text: '',
        error: error.message
      };
    }
  }

  /**
   * Verify receipt authenticity and extract key information
   */
  async verifyReceipt(imageUrl: string): Promise<{
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
    error?: string;
  }> {
    try {
      // Extract text
      const ocrResult = await this.extractReceiptText(imageUrl);

      if (!ocrResult.success) {
        return {
          isValid: false,
          confidence: 0,
          extractedData: {},
          rawText: '',
          error: ocrResult.error
        };
      }

      const text = ocrResult.text.toLowerCase();

      // Parse receipt data
      const extractedData = this.parseReceiptData(ocrResult.text);

      // Verify receipt (basic checks)
      const isValid = this.validateReceipt(text, extractedData);
      const confidence = this.calculateConfidence(text, extractedData);

      return {
        isValid,
        confidence,
        extractedData,
        rawText: ocrResult.text
      };

    } catch (error: any) {
      console.error('❌ Receipt verification error:', error);
      return {
        isValid: false,
        confidence: 0,
        extractedData: {},
        rawText: '',
        error: error.message
      };
    }
  }

  /**
   * Parse receipt data from extracted text
   */
  private parseReceiptData(text: string): any {
    const data: any = {};

    // Extract store name (usually first few lines)
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      data.storeName = lines[0].trim();
    }

    // Extract date (look for date patterns)
    const dateMatch = text.match(/\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/);
    if (dateMatch) {
      data.date = dateMatch[0];
    }

    // Extract total amount (look for "total", "amount", etc.)
    const totalMatch = text.match(/total[:\s]*[₦$£€]?\s*(\d+[,.]?\d*)/i);
    if (totalMatch) {
      data.totalAmount = parseFloat(totalMatch[1].replace(',', ''));
    }

    // Extract receipt number
    const receiptMatch = text.match(/(?:receipt|ref|invoice)[#:\s]*(\w+)/i);
    if (receiptMatch) {
      data.receiptNumber = receiptMatch[1];
    }

    // Extract items (basic - lines with prices)
    const items: string[] = [];
    const itemPattern = /(.+?)\s+[₦$£€]?\s*\d+[,.]?\d*/g;
    let match;
    while ((match = itemPattern.exec(text)) !== null) {
      if (match[1].trim().length > 3) {
        items.push(match[1].trim());
      }
    }
    data.items = items.slice(0, 10); // Max 10 items

    return data;
  }

  /**
   * Validate if text looks like a receipt
   */
  private validateReceipt(text: string, data: any): boolean {
    // Check for receipt indicators
    const hasTotal = text.includes('total') || text.includes('amount');
    const hasDate = !!data.date;
    const hasPrice = /\d+[,.]?\d*/.test(text);
    const hasStoreName = !!data.storeName;

    // Receipt is valid if it has at least 2 of these
    const indicators = [hasTotal, hasDate, hasPrice, hasStoreName];
    const validCount = indicators.filter(Boolean).length;

    return validCount >= 2;
  }

  /**
   * Calculate confidence score (0-1)
   */
  private calculateConfidence(text: string, data: any): number {
    let score = 0;

    // Check for various receipt elements
    if (data.storeName) score += 0.2;
    if (data.date) score += 0.2;
    if (data.totalAmount) score += 0.3;
    if (data.receiptNumber) score += 0.15;
    if (data.items && data.items.length > 0) score += 0.15;

    // Bonus for common receipt keywords
    const keywords = ['receipt', 'invoice', 'paid', 'cashier', 'tax', 'subtotal'];
    const keywordCount = keywords.filter(k => text.toLowerCase().includes(k)).length;
    score += Math.min(keywordCount * 0.05, 0.2);

    return Math.min(score, 1.0);
  }

  /**
   * Compare product details with receipt
   */
  async matchProductWithReceipt(
    productName: string,
    productPrice: number,
    receiptImageUrl: string
  ): Promise<{
    matches: boolean;
    confidence: number;
    details: string;
  }> {
    try {
      const verification = await this.verifyReceipt(receiptImageUrl);

      if (!verification.isValid) {
        return {
          matches: false,
          confidence: 0,
          details: 'Receipt could not be verified'
        };
      }

      const text = verification.rawText.toLowerCase();
      const productLower = productName.toLowerCase();

      // Check if product name appears in receipt
      const nameMatch = text.includes(productLower) || 
                       verification.extractedData.items?.some(item => 
                         item.toLowerCase().includes(productLower)
                       );

      // Check if price is close
      const receiptTotal = verification.extractedData.totalAmount;
      const priceMatch = receiptTotal && 
                        Math.abs(receiptTotal - productPrice) / productPrice < 0.1; // 10% tolerance

      let confidence = verification.confidence;
      if (nameMatch) confidence += 0.2;
      if (priceMatch) confidence += 0.2;

      return {
        matches: nameMatch || priceMatch,
        confidence: Math.min(confidence, 1.0),
        details: `Receipt ${verification.isValid ? 'verified' : 'invalid'}. ` +
                `${nameMatch ? 'Product name found. ' : ''}` +
                `${priceMatch ? 'Price matches. ' : ''}`
      };

    } catch (error: any) {
      return {
        matches: false,
        confidence: 0,
        details: 'Error verifying receipt: ' + error.message
      };
    }
  }
}