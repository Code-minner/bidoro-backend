// backend/routes/kycRoutes.ts
// ============================================
import express, { Response } from "express";
import {
  AuthRequest,
  authenticateToken,
  authenticateForKyc,
} from "../middleware/auth";
import { supabaseAdmin as supabase } from "../config/database";
import { uploadMiddleware } from "../middleware/upload";
import flutterwaveService from "../services/flutterwaveService";
import { emailService } from "../services/emailService";

const router = express.Router();

router.post(
  "/verify-bank",
  authenticateForKyc,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { accountNumber, bankCode } = req.body;

      console.log("\n=== BANK VERIFICATION REQUEST ===");
      console.log("User ID:", userId);
      console.log("Account Number:", accountNumber);
      console.log("Bank Code:", bankCode);

      if (!accountNumber || !bankCode) {
        return res.status(400).json({
          success: false,
          message: "Account number and bank code are required",
        });
      }

      if (!/^\d{10}$/.test(accountNumber)) {
        return res.status(400).json({
          success: false,
          message: "Account number must be 10 digits",
        });
      }

      // Check if already verified
      const { data: existing } = await supabase
        .from("bank_verifications")
        .select("*")
        .eq("user_id", userId)
        .eq("account_number", accountNumber)
        .eq("bank_code", bankCode)
        .eq("is_verified", true)
        .single();

      console.log("Existing verification found:", existing);

      if (existing) {
        return res.json({
          success: true,
          data: {
            account_name: existing.account_name,
            is_verified: true,
            cached: true,
          },
        });
      }

      // Verify with Flutterwave
      console.log("Calling Flutterwave verification...");
      const verification = await flutterwaveService.verifyAccount(
        accountNumber,
        bankCode
      );

      console.log("Flutterwave response:", verification);

      if (!verification || !verification.account_name) {
        return res.status(400).json({
          success: false,
          message: "Could not verify bank account. Please check your details.",
        });
      }

      // Store verification result
      console.log("Saving to database...");
      const { data: savedVerification, error: saveError } = await supabase
        .from("bank_verifications")
        .upsert({
          user_id: userId,
          account_number: accountNumber,
          bank_code: bankCode,
          account_name: verification.account_name,
          is_verified: true,
          flutterwave_response: verification,
          verified_at: new Date().toISOString(),
        })
        .select()
        .single();

      console.log("Save result:", savedVerification);
      console.log("Save error:", saveError);

      if (saveError) {
        console.error("❌ Failed to save verification:", saveError);
      }

      res.json({
        success: true,
        data: {
          account_name: verification.account_name,
          is_verified: true,
          cached: false,
        },
      });
    } catch (error: any) {
      console.error("Bank verification error:", error);

      if (error.message?.includes("Invalid account")) {
        return res.status(400).json({
          success: false,
          message: "Invalid account number or bank code",
        });
      }

      res.status(500).json({
        success: false,
        message:
          "Verification service temporarily unavailable. Please try again.",
      });
    }
  }
);

// POST /api/kyc/upload
router.post(
  "/upload",
  authenticateForKyc,
  uploadMiddleware.single("document"),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { document_type } = req.body;
      const file = req.file;

      console.log("📤 Upload endpoint hit:", {
        userId,
        document_type,
        hasFile: !!file,
      });

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      if (!document_type) {
        return res.status(400).json({
          success: false,
          message: "Document type is required",
        });
      }

      const validTypes = ["id_card", "selfie", "business_cert", "store_logo"];
      if (!validTypes.includes(document_type)) {
        return res.status(400).json({
          success: false,
          message: "Invalid document type",
        });
      }

      // Get or create application
      let { data: application } = await supabase
        .from("kyc_applications")
        .select("application_id")
        .eq("user_id", userId)
        .single();

      if (!application) {
        const { data: newApp, error } = await supabase
          .from("kyc_applications")
          .insert({
            user_id: userId,
            status: "draft",
            current_step: 1,
          })
          .select("application_id")
          .single();

        if (error) throw error;
        application = newApp;
      }

      // Store document record
      const { data: document, error: docError } = await supabase
        .from("kyc_documents")
        .insert({
          application_id: application.application_id,
          user_id: userId,
          document_type,
          file_name: file.originalname,
          file_url: file.path,
          file_size: file.size,
          mime_type: file.mimetype,
        })
        .select()
        .single();

      if (docError) throw docError;

      // Update application with file URL
      const updateField =
        document_type === "id_card"
          ? "id_document_url"
          : document_type === "selfie"
          ? "selfie_photo_url"
          : document_type === "business_cert"
          ? "business_cert_url"
          : document_type === "store_logo"
          ? "store_logo_url"
          : null;

      if (updateField) {
        await supabase
          .from("kyc_applications")
          .update({ [updateField]: file.path })
          .eq("application_id", application.application_id);
      }

      res.json({
        success: true,
        message: "Document uploaded successfully",
        data: {
          document_id: document.document_id,
          file_url: file.path,
          document_type,
        },
      });
    } catch (error) {
      console.error("Document upload error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// ============================================
// Get list of banks (for dropdown)
// ============================================
router.get("/banks", async (req: AuthRequest, res: Response) => {
  try {
    const country = "NG"; // Nigeria
    const banks = await flutterwaveService.getBanks(country);

    res.json({
      success: true,
      data: banks,
    });
  } catch (error) {
    console.error("Failed to fetch banks:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load banks",
    });
  }
});

// ============================================
// UPDATED: KYC Submit - Now handles bank verification properly
// ============================================
router.post(
  "/submit",
  authenticateForKyc,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { formData } = req.body;

      console.log("Received KYC submission:", formData);

      console.log("\n=== VALIDATION CHECKS ===");

      // Validate identity
      if (
        !formData.verifyIdentity?.address ||
        !formData.verifyIdentity?.state ||
        !formData.verifyIdentity?.lga ||
        !formData.verifyIdentity?.idNum
      ) {
        console.log("❌ FAILED: Identity verification information");
        return res.status(400).json({
          success: false,
          message: "Identity verification information is incomplete",
        });
      }
      console.log("✅ PASSED: Identity verification");

      // Validate business info
      if (!formData.businessInfo?.storeName) {
        console.log("❌ FAILED: Business information - missing storeName");
        return res.status(400).json({
          success: false,
          message: "Business information is incomplete",
        });
      }
      console.log("✅ PASSED: Business information");

      // Validate store setup
      if (!formData.storeSetup?.storeCat || !formData.storeSetup?.policyAgree) {
        console.log("❌ FAILED: Store setup information");
        return res.status(400).json({
          success: false,
          message: "Store setup information is incomplete",
        });
      }
      console.log("✅ PASSED: Store setup");

      // Validate bank account info
      if (
        !formData.withdrawalDetails?.accountNumber ||
        !formData.withdrawalDetails?.bankCode
      ) {
        console.log("❌ FAILED: Bank account information");
        return res.status(400).json({
          success: false,
          message: "Bank account information is incomplete",
        });
      }
      console.log("✅ PASSED: Bank account information");

      // ============================================
      // UPDATED: Check bank verification with fallback
      // ============================================
      console.log("\n=== CHECKING BANK VERIFICATION ===");
      console.log("User ID:", userId);
      console.log("Account Number:", formData.withdrawalDetails.accountNumber);
      console.log("Bank Code:", formData.withdrawalDetails.bankCode);
      console.log("Account Name from frontend:", formData.withdrawalDetails.accountName);

      // First, check if verification exists in bank_verifications table
      let { data: bankVerification, error: bankVerifyError } = await supabase
        .from("bank_verifications")
        .select("*")
        .eq("user_id", userId)
        .eq("account_number", formData.withdrawalDetails.accountNumber)
        .eq("bank_code", formData.withdrawalDetails.bankCode)
        .eq("is_verified", true)
        .single();

      console.log("Bank verification from table:", bankVerification);

      // ✅ NEW: If not found in bank_verifications, check if frontend provided accountName
      // This means it was verified via /seller/bank-account/verify (Paystack)
      if (!bankVerification && formData.withdrawalDetails.accountName) {
        console.log("⚠️ No bank_verifications record found, but frontend provided accountName");
        console.log("Creating bank_verifications record from Paystack verification...");

        // Create the verification record since Paystack already verified it
        const { data: newVerification, error: createError } = await supabase
          .from("bank_verifications")
          .upsert({
            user_id: userId,
            account_number: formData.withdrawalDetails.accountNumber,
            bank_code: formData.withdrawalDetails.bankCode,
            account_name: formData.withdrawalDetails.accountName,
            is_verified: true,
            verified_at: new Date().toISOString(),
            // Note: We don't have paystack_response here, but that's okay
          })
          .select()
          .single();

        if (createError) {
          console.error("Failed to create bank verification record:", createError);
        } else {
          console.log("✅ Created bank_verifications record:", newVerification);
          bankVerification = newVerification;
        }
      }

      // Also check seller_bank_accounts table as fallback
      if (!bankVerification) {
        console.log("Checking seller_bank_accounts table...");
        const { data: sellerBankAccount } = await supabase
          .from("seller_bank_accounts")
          .select("*")
          .eq("user_id", userId)
          .eq("account_number", formData.withdrawalDetails.accountNumber)
          .eq("bank_code", formData.withdrawalDetails.bankCode)
          .eq("is_verified", true)
          .single();

        if (sellerBankAccount) {
          console.log("✅ Found verified account in seller_bank_accounts:", sellerBankAccount);
          // Create bank_verifications record from seller_bank_accounts
          const { data: newVerification } = await supabase
            .from("bank_verifications")
            .upsert({
              user_id: userId,
              account_number: sellerBankAccount.account_number,
              bank_code: sellerBankAccount.bank_code,
              account_name: sellerBankAccount.account_name,
              is_verified: true,
              verified_at: new Date().toISOString(),
            })
            .select()
            .single();

          bankVerification = newVerification || {
            account_name: sellerBankAccount.account_name,
            is_verified: true,
          };
        }
      }

      // Final check - if still no verification, reject
      if (!bankVerification) {
        console.log("❌ FAILED: Bank account not verified");
        console.log("No verification found in bank_verifications or seller_bank_accounts");
        console.log("And no accountName provided from frontend");
        return res.status(400).json({
          success: false,
          message:
            "Bank account must be verified before submission. Please verify your bank account again.",
        });
      }
      console.log("✅ PASSED: Bank verification");

      // ============================================
      // Check for required documents
      // ============================================
      const { data: documents, error: docError } = await supabase
        .from("kyc_documents")
        .select("document_type")
        .eq("user_id", userId);

      console.log("Documents query result:", documents);

      const uploadedTypes = documents?.map((d) => d.document_type) || [];
      
      // ✅ UPDATED: business_cert is now optional
      const requiredDocs = ["id_card", "selfie", "store_logo"];
      const missingDocs = requiredDocs.filter(
        (doc) => !uploadedTypes.includes(doc)
      );

      console.log("Uploaded document types:", uploadedTypes);
      console.log("Required document types:", requiredDocs);
      console.log("Missing documents:", missingDocs);

      if (missingDocs.length > 0) {
        console.log("❌ FAILED: Missing required documents:", missingDocs.join(", "));
        return res.status(400).json({
          success: false,
          message: `Missing required documents: ${missingDocs.join(", ")}`,
        });
      }
      console.log("✅ PASSED: All documents present");

      console.log("=== ALL VALIDATIONS PASSED ===\n");

      // Get or create application
      const { data: existingApp } = await supabase
        .from("kyc_applications")
        .select("application_id")
        .eq("user_id", userId)
        .single();

      const applicationData = {
        user_id: userId,
        status: "submitted",
        current_step: 4,

        // Identity data
        identity_address: formData.verifyIdentity.address,
        identity_state: formData.verifyIdentity.state,
        identity_lga: formData.verifyIdentity.lga,
        identity_number: formData.verifyIdentity.idNum,

        // Business data
        store_name: formData.businessInfo.storeName,
        store_address: formData.businessInfo.storeAddress,
        business_id: formData.businessInfo.businessID || null,

        // Store data
        store_category: formData.storeSetup.storeCat,
        pickup_options: formData.storeSetup.pickupOptions
          ? [formData.storeSetup.pickupOptions]
          : null,
        active_hours: formData.storeSetup.activeHours,
        policies_agreed: formData.storeSetup.policyAgree,

        // Bank data - use bankVerification.account_name (verified)
        account_number: formData.withdrawalDetails.accountNumber,
        bank_name: formData.withdrawalDetails.bankName,
        bank_code: formData.withdrawalDetails.bankCode,
        account_name: bankVerification.account_name,

        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      let application;
      if (existingApp) {
        const { data, error } = await supabase
          .from("kyc_applications")
          .update(applicationData)
          .eq("application_id", existingApp.application_id)
          .select()
          .single();

        if (error) throw error;
        application = data;
      } else {
        const { data, error } = await supabase
          .from("kyc_applications")
          .insert(applicationData)
          .select()
          .single();

        if (error) throw error;
        application = data;
      }

      // Update user KYC status
      const { error: userUpdateError } = await supabase
        .from("users")
        .update({
          kyc_status: "submitted",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (userUpdateError) {
        console.error("Failed to update user kyc_status:", userUpdateError);
      } else {
        console.log(`✅ User ${userId} kyc_status updated to 'submitted'`);
      }

      // Log status change
      await supabase.from("kyc_status_history").insert({
        application_id: application.application_id,
        from_status: "draft",
        to_status: "submitted",
        changed_by: userId,
        reason: "Application submitted by user",
      });

      // Send emails
      try {
        const { data: user } = await supabase
          .from("users")
          .select("name, email")
          .eq("user_id", userId)
          .single();

        if (user) {
          await emailService.sendKycSubmissionConfirmation({
            name: user.name,
            email: user.email,
            applicationId: application.application_id,
            storeName: formData.businessInfo.storeName,
          });

          await emailService.sendAdminKycNotification({
            applicationId: application.application_id,
            userEmail: user.email,
            storeName: formData.businessInfo.storeName,
          });
        }
      } catch (emailError) {
        console.error("Email notification failed:", emailError);
      }

      res.json({
        success: true,
        message:
          "KYC application submitted successfully! We will review your application within 2-3 business days.",
        data: {
          application_id: application.application_id,
          status: application.status,
          submitted_at: application.submitted_at,
        },
      });
    } catch (error) {
      console.error("KYC submission error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error. Please try again.",
      });
    }
  }
);

export default router;