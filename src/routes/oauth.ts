// routes/oauth.ts
import express from "express";
import { Request, Response } from "express";
import { supabase } from "../config/database";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/auth";

const router = express.Router();

// Google OAuth callback handler
router.post("/google", async (req: Request, res: Response) => {
  try {
    const { access_token, user: oauthUser, mode = "login" } = req.body;

    console.log("OAuth request received:", { email: oauthUser?.email, mode });

    if (!access_token || !oauthUser) {
      return res.status(400).json({
        success: false,
        message: "Missing OAuth data",
      });
    }

    const { id: oauth_id, email, user_metadata } = oauthUser;
    const name = user_metadata?.full_name || user_metadata?.name || email.split('@')[0];
    const avatar_url = user_metadata?.avatar_url || user_metadata?.picture || null;

    // Check if user already exists with this email
    const { data: existingUser, error: findError } = await supabase
      .from("users")
      .select(`
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
        account_status,
        kyc_status,
        trust_score,
        total_sales,
        total_purchases,
        oauth_provider,
        oauth_id,
        created_at
      `)
      .eq("email", email)
      .single();

    let user;
    let isNewUser = false;

    if (existingUser) {
      // User exists
      if (mode === "signup") {
        // User trying to sign up but already exists - that's okay, just log them in
        console.log(`User ${email} already exists, logging in instead of signing up`);
      }

      // Update OAuth info if not already set
      if (!existingUser.oauth_provider) {
        await supabase
          .from("users")
          .update({
            oauth_provider: "google",
            oauth_id: oauth_id,
            profile_picture: existingUser.profile_picture || avatar_url,
            email_verified: true,
            email_verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", existingUser.user_id);
      }

      // Update last active
      await supabase
        .from("users")
        .update({ last_active: new Date().toISOString() })
        .eq("user_id", existingUser.user_id);

      user = existingUser;
    } else {
      // User doesn't exist
      if (mode === "login") {
        // Trying to login but no account exists
        console.log(`Login attempt for non-existent user: ${email}`);
        return res.status(404).json({
          success: false,
          code: "USER_NOT_FOUND",
          message: "No account found with this email. Please sign up first.",
        });
      }

      // mode === "signup" - Create new user
      console.log(`Creating new user: ${email}`);
      isNewUser = true;

      const { data: newUser, error: createError } = await supabase
        .from("users")
        .insert({
          name,
          email,
          password: null, // OAuth users don't have a password
          profile_picture: avatar_url,
          role: "buyer",
          account_status: "active",
          email_verified: true, // Google emails are pre-verified
          email_verified_at: new Date().toISOString(),
          oauth_provider: "google",
          oauth_id: oauth_id,
        })
        .select(`
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
          account_status,
          kyc_status,
          trust_score,
          total_sales,
          total_purchases,
          created_at
        `)
        .single();

      if (createError) {
        console.error("OAuth user creation error:", createError);
        return res.status(500).json({
          success: false,
          message: "Failed to create user account",
        });
      }

      user = newUser;

      // Create user profile for messaging system
      try {
        const username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '_');
        
        await supabase
          .from("user_profiles")
          .insert({
            id: newUser.user_id,
            username: username,
            full_name: name,
            avatar_url: avatar_url,
            is_online: true,
            last_seen: new Date().toISOString(),
            created_at: new Date().toISOString()
          });

        console.log(`User profile created for OAuth user ${email}`);
      } catch (profileError) {
        console.error("Failed to create user profile:", profileError);
      }
    }

    // Update user profile online status
    try {
      await supabase
        .from("user_profiles")
        .upsert({
          id: user.user_id,
          is_online: true,
          last_seen: new Date().toISOString()
        });
    } catch (profileError) {
      console.error("Failed to update profile online status:", profileError);
    }

    // Generate JWT tokens
    const accessToken = generateAccessToken(user.user_id, user.email);
    const refreshToken = generateRefreshToken(user.user_id);

    console.log(`OAuth ${mode} successful for ${user.email}`);

    res.json({
      success: true,
      message: isNewUser ? "Account created successfully" : "Login successful",
      data: {
        user: {
          user_id: user.user_id,
          name: user.name,
          email: user.email,
          phone_number: user.phone_number,
          location_state: user.location_state,
          location_city: user.location_city,
          location_area: user.location_area,
          bio: user.bio,
          profile_picture: user.profile_picture,
          role: user.role,
          seller_type: user.seller_type,
          account_status: user.account_status,
          kyc_status: user.kyc_status,
          trust_score: user.trust_score,
          email_verified: true,
          created_at: user.created_at,
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
      },
    });
  } catch (error) {
    console.error("Google OAuth error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;