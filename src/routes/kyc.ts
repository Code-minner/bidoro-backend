// backend/routes/kycRoutes.ts
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
import dojahService from "../services/dojahService"; // ✅ NEW

const router = express.Router();

// ============================================
// ✅ NEW: POST /api/kyc/verify-nin
// ============================================
router.post(
  "/verify-nin",
  authenticateForKyc,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { nin } = req.body;

      console.log("\n=== NIN VERIFICATION REQUEST ===");
      console.log("User ID:", userId);
      console.log("NIN:", nin);

      // Validate NIN format
      if (!nin) {
        return res.status(400).json({
          success: false,
          message: "NIN is required",
        });
      }

      if (!/^\d{11}$/.test(nin)) {
        return res.status(400).json({
          success: false,
          message: "NIN must be exactly 11 digits",
        });
      }

      // Check if already verified for this user to avoid burning credits
      const { data: existingVerification } = await supabase
        .from("nin_verifications")
        .select("*")
        .eq("user_id", userId)
        .eq("nin", nin)
        .eq("is_verified", true)
        .single();

      if (existingVerification) {
        console.log("✅ Returning cached NIN verification");
        return res.json({
          success: true,
          data: {
            firstName: existingVerification.first_name,
            lastName: existingVerification.last_name,
            middleName: existingVerification.middle_name,
            dateOfBirth: existingVerification.date_of_birth,
            gender: existingVerification.gender,
            photo: existingVerification.photo_url,
            is_verified: true,
            cached: true,
          },
        });
      }

      // Call Dojah API
      const ninData = await dojahService.verifyNIN(nin);

      // Save verification result to DB
      const { error: saveError } = await supabase
        .from("nin_verifications")
        .upsert({
          user_id: userId,
          nin: nin,
          first_name: ninData.firstName,
          last_name: ninData.lastName,
          middle_name: ninData.middleName || null,
          date_of_birth: ninData.dateOfBirth || null,
          gender: ninData.gender || null,
          phone: ninData.phone || null,
          photo_url: ninData.photo || null,
          is_verified: true,
          verified_at: new Date().toISOString(),
        });

      if (saveError) {
        console.error("Failed to save NIN verification:", saveError);
        // Don't fail the request - we still have the data
      }

      console.log("✅ NIN verified successfully:", ninData.firstName, ninData.lastName);

      res.json({
        success: true,
        data: {
          firstName: ninData.firstName,
          lastName: ninData.lastName,
          middleName: ninData.middleName,
          dateOfBirth: ninData.dateOfBirth,
          gender: ninData.gender,
          photo: ninData.photo,
          is_verified: true,
          cached: false,
        },
      });
    } catch (error: any) {
      console.error("NIN verification error:", error);

      if (error.message?.includes("Invalid NIN")) {
        return res.status(400).json({
          success: false,
          message: "Invalid NIN. Please check the number and try again.",
        });
      }

      if (error.message?.includes("not found")) {
        return res.status(404).json({
          success: false,
          message: "NIN not found in the government database.",
        });
      }

      if (error.message?.includes("credits")) {
        return res.status(503).json({
          success: false,
          message: "Verification service temporarily unavailable.",
        });
      }

      res.status(500).json({
        success: false,
        message: "NIN verification failed. Please try again.",
      });
    }
  }
);

// ============================================
// POST /api/kyc/verify-bank (unchanged)
// ============================================
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

      const { data: existing } = await supabase
        .from("bank_verifications")
        .select("*")
        .eq("user_id", userId)
        .eq("account_number", accountNumber)
        .eq("bank_code", bankCode)
        .eq("is_verified", true)
        .single();

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

      const verification = await flutterwaveService.verifyAccount(
        accountNumber,
        bankCode
      );

      if (!verification || !verification.account_name) {
        return res.status(400).json({
          success: false,
          message: "Could not verify bank account. Please check your details.",
        });
      }

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
        message: "Verification service temporarily unavailable. Please try again.",
      });
    }
  }
);

// ============================================
// POST /api/kyc/upload (unchanged)
// ============================================
router.post(
  "/upload",
  authenticateForKyc,
  uploadMiddleware.single("document"),
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { document_type } = req.body;
      const file = req.file;

      console.log("📤 Upload endpoint hit:", { userId, document_type, hasFile: !!file });

      if (!file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      if (!document_type) {
        return res.status(400).json({ success: false, message: "Document type is required" });
      }

      const validTypes = ["id_card", "selfie", "business_cert", "store_logo"];
      if (!validTypes.includes(document_type)) {
        return res.status(400).json({ success: false, message: "Invalid document type" });
      }

      let { data: application } = await supabase
        .from("kyc_applications")
        .select("application_id")
        .eq("user_id", userId)
        .single();

      if (!application) {
        const { data: newApp, error } = await supabase
          .from("kyc_applications")
          .insert({ user_id: userId, status: "draft", current_step: 1 })
          .select("application_id")
          .single();

        if (error) throw error;
        application = newApp;
      }

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

      const updateField =
        document_type === "id_card" ? "id_document_url" :
        document_type === "selfie" ? "selfie_photo_url" :
        document_type === "business_cert" ? "business_cert_url" :
        document_type === "store_logo" ? "store_logo_url" : null;

      if (updateField) {
        await supabase
          .from("kyc_applications")
          .update({ [updateField]: file.path })
          .eq("application_id", application.application_id);
      }

      res.json({
        success: true,
        message: "Document uploaded successfully",
        data: { document_id: document.document_id, file_url: file.path, document_type },
      });
    } catch (error) {
      console.error("Document upload error:", error);
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
);

// ============================================
// GET /api/kyc/banks (unchanged)
// ============================================
router.get("/banks", async (req: AuthRequest, res: Response) => {
  try {
    const banks = await flutterwaveService.getBanks("NG");
    res.json({ success: true, data: banks });
  } catch (error) {
    console.error("Failed to fetch banks:", error);
    res.status(500).json({ success: false, message: "Failed to load banks" });
  }
});

// ============================================
// POST /api/kyc/submit — Updated to check NIN verification
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
        return res.status(400).json({
          success: false,
          message: "Identity verification information is incomplete",
        });
      }
      console.log("✅ PASSED: Identity verification");

      // ✅ NEW: Check that NIN was actually verified via Dojah
      const { data: ninVerification } = await supabase
        .from("nin_verifications")
        .select("*")
        .eq("user_id", userId)
        .eq("nin", formData.verifyIdentity.idNum)
        .eq("is_verified", true)
        .single();

      if (!ninVerification) {
        console.log("❌ FAILED: NIN not verified");
        return res.status(400).json({
          success: false,
          message: "NIN must be verified before submission. Please verify your NIN on step 1.",
        });
      }
      console.log("✅ PASSED: NIN verified —", ninVerification.first_name, ninVerification.last_name);

      // Validate business info
      if (!formData.businessInfo?.storeName) {
        return res.status(400).json({
          success: false,
          message: "Business information is incomplete",
        });
      }
      console.log("✅ PASSED: Business information");

      // Validate store setup
      if (!formData.storeSetup?.storeCat || !formData.storeSetup?.policyAgree) {
        return res.status(400).json({
          success: false,
          message: "Store setup information is incomplete",
        });
      }
      console.log("✅ PASSED: Store setup");

      // Validate bank account
      if (!formData.withdrawalDetails?.accountNumber || !formData.withdrawalDetails?.bankCode) {
        return res.status(400).json({
          success: false,
          message: "Bank account information is incomplete",
        });
      }
      console.log("✅ PASSED: Bank account information");

      // Check bank verification
      let { data: bankVerification } = await supabase
        .from("bank_verifications")
        .select("*")
        .eq("user_id", userId)
        .eq("account_number", formData.withdrawalDetails.accountNumber)
        .eq("bank_code", formData.withdrawalDetails.bankCode)
        .eq("is_verified", true)
        .single();

      if (!bankVerification && formData.withdrawalDetails.accountName) {
        const { data: newVerification, error: createError } = await supabase
          .from("bank_verifications")
          .upsert({
            user_id: userId,
            account_number: formData.withdrawalDetails.accountNumber,
            bank_code: formData.withdrawalDetails.bankCode,
            account_name: formData.withdrawalDetails.accountName,
            is_verified: true,
            verified_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (!createError) bankVerification = newVerification;
      }

      if (!bankVerification) {
        const { data: sellerBankAccount } = await supabase
          .from("seller_bank_accounts")
          .select("*")
          .eq("user_id", userId)
          .eq("account_number", formData.withdrawalDetails.accountNumber)
          .eq("bank_code", formData.withdrawalDetails.bankCode)
          .eq("is_verified", true)
          .single();

        if (sellerBankAccount) {
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

      if (!bankVerification) {
        return res.status(400).json({
          success: false,
          message: "Bank account must be verified before submission.",
        });
      }
      console.log("✅ PASSED: Bank verification");

      // Check documents
      const { data: documents } = await supabase
        .from("kyc_documents")
        .select("document_type")
        .eq("user_id", userId);

      const uploadedTypes = documents?.map((d) => d.document_type) || [];
      const requiredDocs = ["id_card", "selfie", "store_logo"];
      const missingDocs = requiredDocs.filter((doc) => !uploadedTypes.includes(doc));

      if (missingDocs.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Missing required documents: ${missingDocs.join(", ")}`,
        });
      }
      console.log("✅ PASSED: All documents present");
      console.log("=== ALL VALIDATIONS PASSED ===\n");

      // Build application data
      const applicationData = {
        user_id: userId,
        status: "submitted",
        current_step: 4,

        // Identity data
        identity_address: formData.verifyIdentity.address,
        identity_state: formData.verifyIdentity.state,
        identity_lga: formData.verifyIdentity.lga,
        identity_number: formData.verifyIdentity.idNum,

        // ✅ Store verified NIN name from Dojah
        nin_verified_name: `${ninVerification.first_name} ${ninVerification.last_name}`,

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

        // Bank data
        account_number: formData.withdrawalDetails.accountNumber,
        bank_name: formData.withdrawalDetails.bankName,
        bank_code: formData.withdrawalDetails.bankCode,
        account_name: bankVerification.account_name,

        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Upsert application
      const { data: existingApp } = await supabase
        .from("kyc_applications")
        .select("application_id")
        .eq("user_id", userId)
        .single();

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
      await supabase
        .from("users")
        .update({ kyc_status: "submitted", updated_at: new Date().toISOString() })
        .eq("user_id", userId);

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
        message: "KYC application submitted successfully! We will review your application within 2-3 business days.",
        data: {
          application_id: application.application_id,
          status: application.status,
          submitted_at: application.submitted_at,
        },
      });
    } catch (error) {
      console.error("KYC submission error:", error);
      res.status(500).json({ success: false, message: "Internal server error. Please try again." });
    }
  }
);

export default router;