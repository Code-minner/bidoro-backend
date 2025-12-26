import express from "express";
import { Request, Response } from "express";
import { supabase } from "../config/database";
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  validateEmail,
  validatePassword,
  verifyToken,
} from "../utils/auth";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import { emailService } from "../services/emailService";

const router = express.Router();

// Test route
router.get("/test", (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Auth routes working!",
  });
});

// Register new user
router.post("/register", async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      password,
      phone_number,
      location_state,
      location_city,
      location_area,
      bio,
      role = "buyer",
    } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: "Email, password, and name are required",
      });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    // Validate role
    const validRoles = ["buyer", "seller", "admin"];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be one of: buyer, seller, admin",
      });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("email")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this email already exists",
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user in your custom users table
    const { data: newUser, error: userError } = await supabase
      .from("users")
      .insert({
        name,
        email,
        password: hashedPassword,
        phone_number,
        location_state,
        location_city,
        location_area,
        bio,
        role,
        account_status: "active",
      })
      .select(
        `
        user_id, 
        name, 
        email, 
        phone_number, 
        location_state,
        location_city,
        location_area,
        bio,
        role, 
        seller_type,
        account_status, 
        kyc_status,
        trust_score,
        created_at
      `
      )
      .single();

    if (userError) {
      console.error("User creation error:", userError);
      return res.status(500).json({
        success: false,
        message: "Failed to create user account",
      });
    }

    // Generate JWT tokens
    const accessToken = generateAccessToken(newUser.user_id, email);
    const refreshToken = generateRefreshToken(newUser.user_id);

    // Generate and send verification email automatically
    try {
      const verificationCode = Math.floor(
        1000 + Math.random() * 9000
      ).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store verification code
      await supabase.from("email_verifications").insert({
        user_id: newUser.user_id,
        email: newUser.email,
        code: verificationCode,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      });

      // Send verification email
      const emailSent = await emailService.sendVerificationEmail({
        name: newUser.name,
        email: newUser.email,
        verificationCode,
      });

      console.log("Registration verification email sent:", emailSent);
      if (process.env.NODE_ENV === "development") {
        console.log(
          `Verification code for ${newUser.email}: ${verificationCode}`
        );
      }
    } catch (emailError) {
      console.error(
        "Failed to send registration verification email:",
        emailError
      );
      // Don't fail the registration if email fails
    }

    res.status(201).json({
      success: true,
      message:
        "User registered successfully. Please check your email for verification code.",
      data: {
        user: newUser,
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Login user
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Get user from database with new schema fields
    const { data: user, error } = await supabase
      .from("users")
      .select(
        `
        user_id, 
        name, 
        email, 
        password, 
        phone_number, 
        location_state,
        location_city,
        location_area,
        bio,
        role, 
        seller_type,
        account_status,
        kyc_status,
        trust_score,
        total_sales,
        total_purchases
      `
      )
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Check account status
    if (user.account_status !== "active") {
      return res.status(401).json({
        success: false,
        message: `Account is ${user.account_status}`,
      });
    }

    // Verify password
    const passwordMatch = await comparePassword(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Update last active
    await supabase
      .from("users")
      .update({ last_active: new Date().toISOString() })
      .eq("user_id", user.user_id);

    // Generate tokens
    const accessToken = generateAccessToken(user.user_id, user.email);
    const refreshToken = generateRefreshToken(user.user_id);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: userWithoutPassword,
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get current user profile
router.get(
  "/profile",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const { data: user, error } = await supabase
        .from("users")
        .select(
          `
        user_id, 
        name, 
        email, 
        phone_number, 
        location_state,
        location_city,
        location_area,
        bio,
        profile_picture,
        role, 
        seller_type,
        kyc_status, 
        trust_score, 
        account_status,
        total_sales,
        total_purchases,
        created_at, 
        updated_at
      `
        )
        .eq("user_id", req.user!.id)
        .single();

      if (error) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.json({
        success: true,
        data: { user },
      });
    } catch (error) {
      console.error("Profile error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Update user profile
router.put(
  "/profile",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        name,
        phone_number,
        location_state,
        location_city,
        location_area,
        bio,
        profile_picture,
      } = req.body;

      const { data: updatedUser, error } = await supabase
        .from("users")
        .update({
          name,
          phone_number,
          location_state,
          location_city,
          location_area,
          bio,
          profile_picture,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", req.user!.id)
        .select(
          `
        user_id, 
        name, 
        email, 
        phone_number, 
        location_state,
        location_city,
        location_area,
        bio,
        profile_picture,
        role, 
        seller_type,
        kyc_status, 
        trust_score, 
        account_status
      `
        )
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message: "Failed to update profile",
        });
      }

      res.json({
        success: true,
        message: "Profile updated successfully",
        data: { user: updatedUser },
      });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Become a seller (main flow for role switching)
router.post(
  "/become-seller",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const { seller_type } = req.body;

      // Validate seller_type
      const validSellerTypes = ["products", "services", "both"];
      if (!seller_type || !validSellerTypes.includes(seller_type)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid seller type. Must be one of: products, services, both",
        });
      }

      // Check if user is already a seller
      if (req.user!.role === "seller") {
        return res.status(400).json({
          success: false,
          message: "User is already a seller",
        });
      }

      // Update user role and seller_type
      const { data: updatedUser, error } = await supabase
        .from("users")
        .update({
          role: "seller",
          seller_type,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", req.user!.id)
        .select(
          `
        user_id, 
        name, 
        email, 
        phone_number, 
        location_state,
        location_city,
        location_area,
        role, 
        seller_type,
        account_status,
        kyc_status,
        trust_score
      `
        )
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message: "Failed to update user role",
        });
      }

      res.json({
        success: true,
        message: `Successfully became a ${seller_type} seller!`,
        data: { user: updatedUser },
      });
    } catch (error) {
      console.error("Become seller error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Update seller type (for existing sellers)
router.put(
  "/seller-type",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const { seller_type } = req.body;

      // Check if user is a seller
      if (req.user!.role !== "seller") {
        return res.status(400).json({
          success: false,
          message: "Only sellers can update seller type",
        });
      }

      // Validate seller_type
      const validSellerTypes = ["products", "services", "both"];
      if (!seller_type || !validSellerTypes.includes(seller_type)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid seller type. Must be one of: products, services, both",
        });
      }

      // Update seller_type
      const { data: updatedUser, error } = await supabase
        .from("users")
        .update({
          seller_type,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", req.user!.id)
        .select(
          `
        user_id, 
        name, 
        email, 
        role, 
        seller_type,
        account_status
      `
        )
        .single();

      if (error) {
        return res.status(400).json({
          success: false,
          message: "Failed to update seller type",
        });
      }

      res.json({
        success: true,
        message: `Seller type updated to ${seller_type}`,
        data: { user: updatedUser },
      });
    } catch (error) {
      console.error("Seller type update error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Get available seller types
router.get("/seller-types", (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      seller_types: [
        {
          value: "products",
          label: "Sell Products",
          description:
            "Sell physical items like electronics, fashion, gadgets, etc.",
          features: [
            "Inventory management",
            "Shipping options",
            "Product photos",
          ],
        },
        {
          value: "services",
          label: "Offer Services",
          description:
            "Provide services like repairs, tutoring, consulting, etc.",
          features: ["Service booking", "Portfolio showcase", "Client reviews"],
        },
        {
          value: "both",
          label: "Products & Services",
          description: "Sell both physical products and offer services",
          features: [
            "Full marketplace access",
            "Flexible offerings",
            "Multiple revenue streams",
          ],
        },
      ],
    },
  });
});

// Legacy route - kept for backward compatibility but redirects to become-seller
router.put(
  "/switch-role",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const { role } = req.body;

      if (role === "seller") {
        return res.status(400).json({
          success: false,
          message: "Use /become-seller endpoint to become a seller",
          redirect: "/api/auth/become-seller",
        });
      }

      if (role === "buyer") {
        // Allow switching back to buyer
        const { data: updatedUser, error } = await supabase
          .from("users")
          .update({
            role: "buyer",
            seller_type: null, // Clear seller type when becoming buyer
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", req.user!.id)
          .select(
            `
          user_id, 
          name, 
          email, 
          role, 
          seller_type,
          account_status
        `
          )
          .single();

        if (error) {
          return res.status(400).json({
            success: false,
            message: "Failed to update role",
          });
        }

        return res.json({
          success: true,
          message: "Role successfully changed to buyer",
          data: { user: updatedUser },
        });
      }

      return res.status(400).json({
        success: false,
        message: "Invalid role. Use /become-seller for seller registration",
      });
    } catch (error) {
      console.error("Role switch error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Refresh access token
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: "Refresh token required",
      });
    }

    const decoded = verifyToken(refresh_token);

    if (decoded.type !== "refresh") {
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // Get user
    const { data: user, error } = await supabase
      .from("users")
      .select("user_id, email")
      .eq("user_id", decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user.user_id, user.email);

    res.json({
      success: true,
      data: {
        access_token: newAccessToken,
      },
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid refresh token",
    });
  }
});

// Send verification email
router.post(
  "/send-verification",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      // Get user
      const { data: user, error } = await supabase
        .from("users")
        .select("email, name, email_verified")
        .eq("user_id", userId)
        .single();

      if (error || !user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.email_verified) {
        return res.status(400).json({
          success: false,
          message: "Email is already verified",
        });
      }

      // Generate verification code (4 digits)
      const verificationCode = Math.floor(
        1000 + Math.random() * 9000
      ).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store verification code
      const { error: codeError } = await supabase
        .from("email_verifications")
        .upsert({
          user_id: userId,
          email: user.email,
          code: verificationCode,
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString(),
        });

      if (codeError) {
        console.error("Verification code storage error:", codeError);
        return res.status(500).json({
          success: false,
          message: "Failed to generate verification code",
        });
      }

      // Send email with SMTP
      const emailSent = await emailService.sendVerificationEmail({
        name: user.name,
        email: user.email,
        verificationCode,
      });

      if (!emailSent) {
        console.error("Failed to send verification email");
        // Continue anyway - user might try resend
      }

      res.json({
        success: true,
        message: "Verification code sent to your email",
        // Remove dev_code in production
        ...(process.env.NODE_ENV === "development" && {
          dev_code: verificationCode,
        }),
      });
    } catch (error) {
      console.error("Send verification error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Verify email with code
router.post("/verify-email", async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required",
      });
    }

    // Get verification record
    const { data: verification, error: verifyError } = await supabase
      .from("email_verifications")
      .select("*")
      .eq("email", email)
      .eq("code", code)
      .single();

    if (verifyError || !verification) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    // Check if code is expired
    if (new Date() > new Date(verification.expires_at)) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired",
      });
    }

    // Get user name for welcome email
    const { data: user } = await supabase
      .from("users")
      .select("name")
      .eq("user_id", verification.user_id)
      .single();

    // Update user as verified
    const { error: updateError } = await supabase
      .from("users")
      .update({
        email_verified: true,
        email_verified_at: new Date().toISOString(),
      })
      .eq("user_id", verification.user_id);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "Failed to verify email",
      });
    }

    // Delete verification record
    await supabase
      .from("email_verifications")
      .delete()
      .eq("user_id", verification.user_id);

    // Send welcome email
    if (user) {
      await emailService.sendWelcomeEmail(email, user.name);
    }

    res.json({
      success: true,
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("Email verification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Resend verification code
router.post("/resend-verification", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Get user
    const { data: user, error } = await supabase
      .from("users")
      .select("user_id, name, email_verified")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    // Generate new verification code
    const verificationCode = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update verification code
    const { error: codeError } = await supabase
      .from("email_verifications")
      .upsert({
        user_id: user.user_id,
        email: email,
        code: verificationCode,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      });

    if (codeError) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate verification code",
      });
    }

    // Send email with SMTP
    const emailSent = await emailService.sendVerificationEmail({
      name: user.name,
      email: email,
      verificationCode,
    });

    if (!emailSent) {
      console.error("Failed to send verification email");
    }

    res.json({
      success: true,
      message: "Verification code sent to your email",
      // Remove dev_code in production
      ...(process.env.NODE_ENV === "development" && {
        dev_code: verificationCode,
      }),
    });
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Forgot password - send reset code
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Check if user exists
    const { data: user, error } = await supabase
      .from("users")
      .select("user_id, name, email")
      .eq("email", email)
      .single();

    if (error || !user) {
      // Don't reveal if email exists or not for security
      return res.json({
        success: true,
        message:
          "If an account with this email exists, a reset code has been sent",
      });
    }

    // Generate 4-digit reset code
    const resetCode = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete any existing reset codes for this user
    await supabase.from("password_resets").delete().eq("user_id", user.user_id);

    // Store new reset code
    const { error: insertError } = await supabase
      .from("password_resets")
      .insert({
        user_id: user.user_id,
        email: user.email,
        code: resetCode,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error("Password reset code storage error:", insertError);
      return res.status(500).json({
        success: false,
        message: "Failed to generate reset code",
      });
    }

    // Send password reset email
    const emailSent = await emailService.sendPasswordResetEmail({
      name: user.name,
      email: user.email,
      resetCode,
    });

    if (!emailSent) {
      console.error("Failed to send password reset email");
    }

    res.json({
      success: true,
      message:
        "If an account with this email exists, a reset code has been sent",
      ...(process.env.NODE_ENV === "development" && { dev_code: resetCode }),
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Reset password with code
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { email, code, new_password } = req.body;

    if (!email || !code || !new_password) {
      return res.status(400).json({
        success: false,
        message: "Email, code, and new password are required",
      });
    }

    // Validate new password
    const passwordValidation = validatePassword(new_password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    // Get reset record
    const { data: resetRecord, error: resetError } = await supabase
      .from("password_resets")
      .select("*")
      .eq("email", email)
      .eq("code", code)
      .eq("used", false)
      .single();

    if (resetError || !resetRecord) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset code",
      });
    }

    // Check if code is expired
    if (new Date() > new Date(resetRecord.expires_at)) {
      return res.status(400).json({
        success: false,
        message: "Reset code has expired",
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(new_password);

    // Update user password
    const { error: updateError } = await supabase
      .from("users")
      .update({
        password: hashedPassword,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", resetRecord.user_id);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: "Failed to update password",
      });
    }

    // Mark reset code as used
    await supabase
      .from("password_resets")
      .update({ used: true })
      .eq("id", resetRecord.id);

    // Send confirmation email
    const { data: user } = await supabase
      .from("users")
      .select("name")
      .eq("user_id", resetRecord.user_id)
      .single();

    if (user) {
      await emailService.sendPasswordChangedEmail({
        name: user.name,
        email: email,
      });
    }

    res.json({
      success: true,
      message: "Password has been reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});


// Resend password reset code
router.post("/resend-reset-code", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Check if user exists
    const { data: user, error } = await supabase
      .from("users")
      .select("user_id, name, email")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.json({
        success: true,
        message:
          "If an account with this email exists, a new reset code has been sent",
      });
    }

    // Generate new 4-digit reset code
    const resetCode = Math.floor(1000 + Math.random() * 9000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update or insert reset code
    await supabase.from("password_resets").delete().eq("user_id", user.user_id);

    await supabase.from("password_resets").insert({
      user_id: user.user_id,
      email: user.email,
      code: resetCode,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
    });

    // Send email
    await emailService.sendPasswordResetEmail({
      name: user.name,
      email: user.email,
      resetCode,
    });

    res.json({
      success: true,
      message:
        "If an account with this email exists, a new reset code has been sent",
      ...(process.env.NODE_ENV === "development" && { dev_code: resetCode }),
    });
  } catch (error) {
    console.error("Resend reset code error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}); // <-- THIS WAS MISSING!

// Change password (authenticated user)
router.post(
  "/change-password",
  authenticateToken,
  async (req: AuthRequest, res: Response) => {
    try {
      const { old_password, new_password } = req.body;
      const userId = req.user!.id;

      if (!old_password || !new_password) {
        return res.status(400).json({
          success: false,
          message: "Old password and new password are required",
        });
      }

      // Validate new password
      const passwordValidation = validatePassword(new_password);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: passwordValidation.message,
        });
      }

      // Get user with current password
      const { data: user, error } = await supabase
        .from("users")
        .select("user_id, email, name, password")
        .eq("user_id", userId)
        .single();

      if (error || !user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Verify old password
      const passwordMatch = await comparePassword(old_password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      // Check if new password is same as old
      const samePassword = await comparePassword(new_password, user.password);
      if (samePassword) {
        return res.status(400).json({
          success: false,
          message: "New password must be different from current password",
        });
      }

      // Hash new password
      const hashedPassword = await hashPassword(new_password);

      // Update password
      const { error: updateError } = await supabase
        .from("users")
        .update({
          password: hashedPassword,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: "Failed to update password",
        });
      }

      // Send confirmation email
      await emailService.sendPasswordChangedEmail({
        name: user.name,
        email: user.email,
      });

      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

 
export default router;
