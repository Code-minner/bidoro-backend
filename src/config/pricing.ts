// ================================================
// BIDORO - PRICING CONFIG (SINGLE SOURCE OF TRUTH)
// File: src/config/pricing.ts
//
// *** CHANGE THE PLATFORM FEE HERE AND ONLY HERE ***
//
// FEE MODEL:
//   Buyer pays:  subtotal + delivery fee = total
//   On payout:   Platform keeps 8.2% of total
//                Seller receives 91.8% of total
//
// There is NO extra fee added to the buyer's checkout.
// The 8.2% is Bidoro's commission taken from the seller
// when escrow funds are released.
// ================================================

// ------------------------------------
// FEE CONFIGURATION (edit here only)
// ------------------------------------
export const PLATFORM_FEE_PERCENT = 8.2;          // 8.2% platform commission from seller
export const AUTO_RELEASE_DAYS = 5;               // Auto-release escrow after 5 days
export const MIN_ORDER_AMOUNT = 100;              // NGN 100 minimum order

// ------------------------------------
// TYPES
// ------------------------------------
export interface PlatformSettings {
  platformFeePercent: number;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  platformFeePercent: PLATFORM_FEE_PERCENT,
};

// ------------------------------------
// CALCULATIONS
// ------------------------------------

/**
 * Calculate what the buyer pays.
 * No extra fees — just subtotal + delivery.
 */
export const calculateBuyerTotal = (
  subtotal: number,
  deliveryFee: number
): number => {
  return Math.round(subtotal + deliveryFee);
};

/**
 * Calculate escrow split on payout.
 * Platform keeps PLATFORM_FEE_PERCENT from the order total.
 * Seller gets the rest.
 *
 * Example (8.2% fee, NGN 10,000 order):
 *   platformFee  = 820
 *   sellerAmount = 9,180
 */
export const calculateEscrowSplit = (
  orderTotal: number,
  feePercent: number = PLATFORM_FEE_PERCENT
) => {
  const platformFee = Math.round((orderTotal * feePercent) / 100);
  const sellerAmount = orderTotal - platformFee;

  return {
    totalAmount: orderTotal,
    platformFee,
    sellerAmount,
    feePercent,
  };
};

/**
 * Format price in Nigerian Naira.
 */
export const formatPrice = (amount: number): string => {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
  }).format(amount);
};