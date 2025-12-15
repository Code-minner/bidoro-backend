// src/services/emailService.ts - Updated with Bidoro Styling
import nodemailer from "nodemailer";

interface EmailVerificationData {
  name: string;
  email: string;
  verificationCode: string;
}

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    // Configure SMTP transporter with ZeptoMail and proper TLS settings
    this.transporter = nodemailer.createTransport({
      host: process.env.ZEPTOMAIL_HOST,
      port: parseInt(process.env.ZEPTOMAIL_PORT || "465"),
      secure: true, // Use SSL for port 465
      auth: {
        user: process.env.ZEPTOMAIL_USER,
        pass: process.env.ZEPTOMAIL_PASS,
      },
      // ADD THESE TLS SETTINGS TO FIX SSL ERRORS
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === "production", // Strict in production, lenient in dev
        minVersion: "TLSv1.2",
        ciphers:
          "ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS",
      },
      // ADD CONNECTION TIMEOUTS
      connectionTimeout: 60000, // 60 seconds
      greetingTimeout: 30000, // 30 seconds
      socketTimeout: 60000, // 60 seconds
      // ADD DEBUG LOGGING IN DEVELOPMENT
      debug: process.env.NODE_ENV === "development",
      logger: process.env.NODE_ENV === "development",
    });

    // Verify connection configuration with better error handling
    this.verifyConnection();
  }

  // IMPROVED CONNECTION VERIFICATION
  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      console.log("✅ ZeptoMail SMTP connection verified successfully");
    } catch (error: any) {
      console.error("❌ Email service configuration error:", error.message);

      // Provide specific guidance based on error type
      if (error.code === "ESOCKET") {
        console.error("🔧 Fix: Check network connection and firewall settings");
      } else if (error.code === "EAUTH") {
        console.error(
          "🔧 Fix: Verify ZEPTOMAIL_USER and ZEPTOMAIL_PASS in .env"
        );
      } else if (error.code === "ECONNECTION") {
        console.error(
          "🔧 Fix: Check ZEPTOMAIL_HOST and ZEPTOMAIL_PORT settings"
        );
      }

      // Don't throw error - allow app to continue running
      console.warn(
        "⚠️  Email service will retry connection on first send attempt"
      );
    }
  }

  async sendVerificationEmail(data: EmailVerificationData): Promise<boolean> {
    try {
      const { name, email, verificationCode } = data;

      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: email,
        subject: "Verify Your Email - BIDORO 🔐",
        html: this.getVerificationEmailTemplate(name, verificationCode),
        text: `Hi ${name},\n\nYour verification code is: ${verificationCode}\n\nThis code will expire in 10 minutes.\n\nBest regards,\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Verification email sent successfully:", result.messageId);

      // Log in development for debugging
      if (process.env.NODE_ENV === "development") {
        console.log(`📧 Verification email sent to: ${email}`);
        console.log(`🔢 Verification code: ${verificationCode}`);
      }

      return true;
    } catch (error: any) {
      console.error("❌ Verification email sending failed:", error.message);

      // Log specific error details for troubleshooting
      if (error.code === "ESOCKET") {
        console.error("🔧 Network/SSL error - check TLS configuration");
      } else if (error.responseCode) {
        console.error(`🔧 SMTP Error ${error.responseCode}: ${error.response}`);
      }

      return false;
    }
  }

  private getVerificationEmailTemplate(
    name: string,
    verificationCode: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 2px solid #1C341A; border-radius: 20px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 0; background-color: #f1f6faff;">
          
          <!-- Header with Logo -->
          <div style="text-align: center; padding: 40px 20px; border-radius: 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); margin: 0;">
            <!-- Your Logo -->
            <img src="https://blogger.googleusercontent.com/img/a/AVvXsEhujOGbWy47k29NCS2fQ5HLpAVigulEi5U_2rdnwVvq0lPEXtcb8L1q__7raTtq-K-RT9XWzaCXpuwV_8ENa-2FXsgPWUUdEE4WHHFCnc86S2cZAvJaAQL3UOUKxDCMc831PtTWtn3tLg2z4pk4PQtiSxAdERuskZvdRpkPgxnylwgJVO8T4t8UXmCUp0o" 
                 alt="BIDORO Logo" 
                 style="width: 200px; height: auto; margin-bottom: 20px; display: block; margin-left: auto; margin-right: auto;"
                 onerror="this.style.display='none'">
            
            <h1 style="color: #1C341A; margin: 0; font-size: 36px; font-weight: bold;">
              Verify Your <span style="color: #DEE563;">Email</span>
            </h1>
            <p style="color: #1C341A; margin: 15px 0 0 0; font-size: 18px;">
              Secure your BIDORO account 
            </p>
          </div>

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 40px 30px; box-shadow: 0 8px 32px rgba(0,0,0,0.1);">
            
            <!-- Personal Greeting -->
            <div style="text-align: center; margin-bottom: 30px;">
              <h2 style="color: #1C341A; margin: 0; font-size: 28px;">
                Hi${name ? ` ${name}` : ""}! 👋
              </h2>
              <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">
                Almost there! Just one more step to activate your account
              </p>
            </div>

            <!-- Welcome Message -->
            <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); padding: 25px; border-radius: 12px; margin: 30px 0; border-left: 4px solid #DEE563;">
              <p style="font-size: 16px; margin: 0; color: #333; line-height: 1.6;">
               <strong>Welcome to BIDORO!</strong> To complete your account setup and start your marketplace journey, please verify your email address using the code below.
              </p>
            </div>

            <!-- Verification Code Section -->
            <div style="text-align: center; margin: 35px 0;">
              <h3 style="color: #1C341A; margin: 0 0 20px 0; font-size: 22px;">
                 Your Verification Code
              </h3>
              
              <!-- Code Display -->
              <div style=" border: 3px solid #1C341A; padding: 30px; border-radius: 15px; margin: 20px 0; box-shadow: 0 8px 20px rgba(28, 52, 26, 0.2);">
                <div style="font-size: 48px; font-weight: bold; color: #1C341A; letter-spacing: 12px; font-family: 'Courier New', monospace; text-shadow: 2px 2px 4px rgba(0,0,0,0.1);">
                  ${verificationCode}
                </div>
                <p style="margin: 15px 0 0 0; color: #1C341A; font-size: 14px; font-weight: 600;">
                  Enter this code to verify your account
                </p>
              </div>
            </div>

            <!-- Instructions -->
            <div style="margin: 35px 0;">
              <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; border-left: 4px solid #DEE563;">
                <h4 style="color: #1C341A; margin: 0 0 15px 0; font-size: 18px;">📋 How to verify:</h4>
                <ol style="margin: 0; padding-left: 20px; color: #333; line-height: 1.6;">
                  <li style="margin-bottom: 8px;">Return to the verification page on BIDORO</li>
                  <li style="margin-bottom: 8px;">Enter the 4-digit code shown above</li>
                  <li style="margin-bottom: 8px;">Click "Verify Email" to activate your account</li>
                </ol>
              </div>
            </div>

            <!-- Security Warning -->
            <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); border: 2px solid #ffc107; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <span style="font-size: 24px; margin-right: 10px;">⚠️</span>
                <strong style="color: #856404; font-size: 16px;">Important Security Notice</strong>
              </div>
              <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.5;">
                This verification code will expire in <strong>10 minutes</strong> for your security. If you didn't create a BIDORO account, please ignore this email.
              </p>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="https://bidoro.africa/verify" 
                 style="display: inline-block; background: linear-gradient(135deg, #1C341A 0%, #DEE563 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(28, 52, 26, 0.3); transition: all 0.3s ease;">
               Verify My Email
              </a>
            </div>

            <!-- Support Section -->
            <div style="text-align: center; margin: 35px 0; padding: 20px; background: #f8f9fa; border-radius: 12px;">
              <p style="margin: 0; color: #666; font-size: 14px;">
                Need help? We're here for you! 
              </p>
              <p style="margin: 5px 0 0 0; color: #1C341A; font-size: 14px;">
                <a href="mailto:hello@bidoro.africa" style="color: #1C341A; text-decoration: none; font-weight: 600;">hello@bidoro.africa</a>
              </p>
            </div>

            <!-- Personal Touch -->
            <div style="border-top: 2px solid #DEE563; padding-top: 25px; margin-top: 35px;">
              <p style="font-size: 16px; color: #333; margin: 0 0 15px 0; line-height: 1.6;">
                We're excited to have you join the BIDORO community! Get ready to discover amazing products and connect with trusted sellers and buyers.
              </p>
              <p style="font-size: 16px; color: #1C341A; margin: 0; font-weight: 600;">
                — The BIDORO Team 
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div style="text-align: center; padding: 30px 20px; background: #f8f9fa; color: #666;">
            <p style="margin: 0 0 10px 0; font-size: 14px;">
              This is an automated security email. Please do not reply to this message.
            </p>
            <p style="margin: 0 0 15px 0; font-size: 14px;">
              Questions? Contact us at <a href="mailto:hello@bidoro.africa" style="color: #1C341A; text-decoration: none; font-weight: 600;">hello@bidoro.africa</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
              © 2025 BIDORO. All rights reserved.
            </p>
          </div>

        </body>
      </html>
    `;
  }

  async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: email,
        subject: "Welcome to BIDORO! 🎉",
        html: this.getWelcomeEmailTemplate(name),
        text: `Hi ${name},\n\nWelcome to BIDORO! Your email has been verified successfully.\n\nYou can now start buying and selling on our platform.\n\nBest regards,\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Welcome email sent successfully:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Welcome email sending failed:", error.message);
      return false;
    }
  }

  private getWelcomeEmailTemplate(name: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 2px solid #1C341A; border-radius: 20px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 0; background-color: #f1f6faff;">
          
          <!-- Header with Logo -->
          <div style="text-align: center; padding: 40px 20px; border-radius: 16px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); margin: 0;">
            <!-- Your Logo -->
            <img src="https://blogger.googleusercontent.com/img/a/AVvXsEhujOGbWy47k29NCS2fQ5HLpAVigulEi5U_2rdnwVvq0lPEXtcb8L1q__7raTtq-K-RT9XWzaCXpuwV_8ENa-2FXsgPWUUdEE4WHHFCnc86S2cZAvJaAQL3UOUKxDCMc831PtTWtn3tLg2z4pk4PQtiSxAdERuskZvdRpkPgxnylwgJVO8T4t8UXmCUp0o" 
                 alt="BIDORO Logo" 
                 style="width: 200px; height: auto; margin-bottom: 20px; display: block; margin-left: auto; margin-right: auto;"
                 onerror="this.style.display='none'">
            
            <h1 style="color: #1C341A; margin: 0; font-size: 36px; font-weight: bold;">
              Welcome to <span style="color: #DEE563;">BIDORO</span>
            </h1>
            <p style="color: #1C341A; margin: 15px 0 0 0; font-size: 18px;">
              Your marketplace journey begins now! 🎉
            </p>
          </div>

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 40px 30px; box-shadow: 0 8px 32px rgba(0,0,0,0.1);">
            
            <!-- Success Message -->
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="display: inline-block; width: 60px; height: 60px; background: linear-gradient(135deg, #1C341A 0%, #DEE563 100%); border-radius: 50%; margin-bottom: 20px; position: relative;">
                <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 30px; font-weight: bold;">✓</span>
              </div>
              <h2 style="color: #1C341A; margin: 0; font-size: 28px;">
                Hi${name ? ` ${name}` : ""}! 👋
              </h2>
              <p style="color: #666; margin: 10px 0 0 0; font-size: 16px;">
                Email verified successfully! Your account is now active
              </p>
            </div>

            <!-- Welcome Message -->
            <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); padding: 25px; border-radius: 12px; margin: 30px 0; border-left: 4px solid #DEE563;">
              <p style="font-size: 16px; margin: 0; color: #333; line-height: 1.6;">
                <strong>Congratulations!</strong> Your BIDORO account is now fully activated. You're ready to explore Nigeria's premier marketplace and connect with trusted buyers and sellers.
              </p>
            </div>

            <!-- Features Section -->
            <div style="margin: 35px 0;">
              <h3 style="color: #1C341A; margin: 0 0 20px 0; font-size: 22px; text-align: center;">
               What You Can Do Now
              </h3>
              
              <div style="display: table; width: 100%; border-spacing: 0;">
                <!-- Feature 1 -->
                <div style="display: table-row;">
                  <div style="display: table-cell; padding: 12px 15px; background: #f8f9fa; border-radius: 8px; margin-bottom: 10px; width: 100%;">
                    <div style="display: flex; align-items: center;">
                      <span style="font-size: 24px; margin-right: 15px;"></span>
                      <div>
                        <strong style="color: #1C341A; font-size: 16px;">Browse & Buy</strong>
                        <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Discover thousands of verified products and services</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <!-- Feature 2 -->
                <div style="display: table-row;">
                  <div style="display: table-cell; padding: 12px 15px; background: #f8f9fa; border-radius: 8px; margin-bottom: 10px; width: 100%; margin-top: 10px;">
                    <div style="display: flex; align-items: center;">
                      <span style="font-size: 24px; margin-right: 15px;"></span>
                      <div>
                        <strong style="color: #1C341A; font-size: 16px;">Start Selling</strong>
                        <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">List your products with our easy-to-use tools</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <!-- Feature 3 -->
                <div style="display: table-row;">
                  <div style="display: table-cell; padding: 12px 15px; background: #f8f9fa; border-radius: 8px; margin-bottom: 10px; width: 100%; margin-top: 10px;">
                    <div style="display: flex; align-items: center;">
                      <span style="font-size: 24px; margin-right: 15px;"></span>
                      <div>
                        <strong style="color: #1C341A; font-size: 16px;">Secure Transactions</strong>
                        <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Enjoy protected payments with our escrow system</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <!-- Feature 4 -->
                <div style="display: table-row;">
                  <div style="display: table-cell; padding: 12px 15px; background: #f8f9fa; border-radius: 8px; width: 100%; margin-top: 10px;">
                    <div style="display: flex; align-items: center;">
                      <span style="font-size: 24px; margin-right: 15px;"></span>
                      <div>
                        <strong style="color: #1C341A; font-size: 16px;">Trusted Community</strong>
                        <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Connect with verified sellers and buyers</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="https://bidoro.africa/dashboard" 
                 style="display: inline-block; background: linear-gradient(135deg, #1C341A 0%, #DEE563 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(28, 52, 26, 0.3); transition: all 0.3s ease;">
                🚀 Start Exploring
              </a>
            </div>

            <!-- Pro Tip -->
            <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); border: 2px solid #DEE563; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <span style="font-size: 24px; margin-right: 10px;"></span>
                <strong style="color: #1C341A; font-size: 16px;">Pro Tip</strong>
              </div>
              <p style="margin: 0; color: #1C341A; font-size: 14px; line-height: 1.5;">
                Complete your profile and verify your identity to build trust with other users and unlock advanced marketplace features.
              </p>
            </div>

            <!-- Support Info -->
            <div style="text-align: center; margin: 35px 0; padding: 20px; background: #f8f9fa; border-radius: 12px;">
              <p style="margin: 0; color: #666; font-size: 14px;">
                Questions or need help getting started? 
              </p>
              <p style="margin: 5px 0 0 0; color: #1C341A; font-size: 14px;">
                <a href="mailto:hello@bidoro.africa" style="color: #1C341A; text-decoration: none; font-weight: 600;">hello@bidoro.africa</a>
              </p>
            </div>

            <!-- Personal Touch -->
            <div style="border-top: 2px solid #DEE563; padding-top: 25px; margin-top: 35px;">
              <p style="font-size: 16px; color: #333; margin: 0 0 15px 0; line-height: 1.6;">
                Welcome to the BIDORO family! We're excited to see what amazing connections and discoveries await you on our platform.
              </p>
              <p style="font-size: 16px; color: #1C341A; margin: 0; font-weight: 600;">
                Happy trading!<br>
                — The BIDORO Team 
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div style="text-align: center; padding: 30px 20px; background: #f8f9fa; color: #666;">
            <p style="margin: 0 0 10px 0; font-size: 14px;">
              You're receiving this email because you created an account on BIDORO.
            </p>
            <p style="margin: 0 0 15px 0; font-size: 14px;">
              Need help? Contact us at <a href="mailto:hello@bidoro.africa" style="color: #1C341A; text-decoration: none; font-weight: 600;">hello@bidoro.africa</a>
            </p>
            <p style="margin: 0; font-size: 12px; color: #999;">
              © 2025 BIDORO. All rights reserved.
            </p>
          </div>

        </body>
      </html>
    `;
  }

  // ADD A TEST METHOD FOR DEBUGGING
  async testEmailService(): Promise<{ success: boolean; message: string }> {
    try {
      // Test connection first
      await this.transporter.verify();

      // Try sending a test email to yourself
      const testResult = await this.sendVerificationEmail({
        name: "Test User",
        email: process.env.SMTP_USER || "test@example.com",
        verificationCode: "1234",
      });

      return {
        success: testResult,
        message: testResult
          ? "Email service is working correctly!"
          : "Email sending failed",
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Email service test failed: ${error.message}`,
      };
    }
  }

  //KYC SECTION---------------------------------------------------------

  // KYC submission confirmation email
  async sendKycSubmissionConfirmation(data: {
    name: string;
    email: string;
    applicationId: string;
    storeName?: string;
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "KYC Application Submitted - BIDORO",
        html: this.getKycSubmissionTemplate(data),
        text: `Hi ${data.name},\n\nYour KYC application has been submitted successfully.\nApplication ID: ${data.applicationId}\n\nWe'll review it within 2-3 business days.\n\nBest regards,\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(
        "✅ KYC submission email sent successfully:",
        result.messageId
      );
      return true;
    } catch (error: any) {
      console.error("❌ KYC submission email failed:", error.message);
      return false;
    }
  }

  // KYC approval email
  async sendKycApprovalEmail(data: {
    name: string;
    email: string;
    storeName?: string;
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "KYC Approved - Welcome to BIDORO Sellers! 🎉",
        html: this.getKycApprovalTemplate(data),
        text: `Hi ${
          data.name
        },\n\nGreat news! Your KYC application has been approved.\n${
          data.storeName ? `Your store "${data.storeName}" is now active.` : ""
        }\n\nYou can now start selling on BIDORO.\n\nBest regards,\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ KYC approval email sent successfully:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ KYC approval email failed:", error.message);
      return false;
    }
  }

  // KYC rejection email
  async sendKycRejectionEmail(data: {
    name: string;
    email: string;
    reason: string;
    applicationId: string;
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "KYC Application Update Required - BIDORO",
        html: this.getKycRejectionTemplate(data),
        text: `Hi ${data.name},\n\nYour KYC application needs updates:\n\n${data.reason}\n\nPlease resubmit with correct information.\n\nBest regards,\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(
        "✅ KYC rejection email sent successfully:",
        result.messageId
      );
      return true;
    } catch (error: any) {
      console.error("❌ KYC rejection email failed:", error.message);
      return false;
    }
  }

  // Admin notification for new KYC
  async sendAdminKycNotification(data: {
    applicationId: string;
    userEmail: string;
    storeName?: string;
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: process.env.ADMIN_EMAIL || "admin@bidoro.africa",
        subject: `New KYC Application - ${data.storeName || "Review Required"}`,
        html: this.getAdminKycTemplate(data),
        text: `New KYC Application\n\nApplication ID: ${
          data.applicationId
        }\nUser: ${data.userEmail}\n${
          data.storeName ? `Store: ${data.storeName}` : ""
        }\n\nPlease review in admin panel.`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(
        "✅ Admin KYC notification sent successfully:",
        result.messageId
      );
      return true;
    } catch (error: any) {
      console.error("❌ Admin KYC notification failed:", error.message);
      return false;
    }
  }

  // Email templates (add these as private methods)
  private getKycSubmissionTemplate(data: {
    name: string;
    applicationId: string;
    storeName?: string;
  }): string {
    return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1C341A;">KYC Application Submitted</h2>
        <p>Hi ${data.name},</p>
        <p>Your KYC application has been submitted successfully and is now under review.</p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Application ID:</strong> ${data.applicationId}</p>
          ${
            data.storeName
              ? `<p><strong>Store Name:</strong> ${data.storeName}</p>`
              : ""
          }
        </div>
        <p>We'll review your application within 2-3 business days and notify you of the outcome.</p>
        <p>Best regards,<br>The BIDORO Team</p>
      </body>
    </html>
  `;
  }

  private getKycApprovalTemplate(data: {
    name: string;
    storeName?: string;
  }): string {
    return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #16a34a;">KYC Application Approved!</h2>
        <p>Hi ${data.name},</p>
        <p>Congratulations! Your KYC application has been approved.</p>
        ${
          data.storeName
            ? `<p>Your store "<strong>${data.storeName}</strong>" is now active and ready for customers!</p>`
            : ""
        }
        <p>You can now:</p>
        <ul>
          <li>List products for sale</li>
          <li>Manage your store profile</li>
          <li>Start receiving orders</li>
        </ul>
        <p>Welcome to the BIDORO seller community!</p>
        <p>Best regards,<br>The BIDORO Team</p>
      </body>
    </html>
  `;
  }

  private getKycRejectionTemplate(data: {
    name: string;
    reason: string;
    applicationId: string;
  }): string {
    return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #dc2626;">KYC Application Update Required</h2>
        <p>Hi ${data.name},</p>
        <p>Your KYC application requires updates before it can be approved.</p>
        <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
          <p><strong>Issue:</strong> ${data.reason}</p>
        </div>
        <p>Please update your application and resubmit for review.</p>
        <p>Application ID: ${data.applicationId}</p>
        <p>Best regards,<br>The BIDORO Team</p>
      </body>
    </html>
  `;
  }

  private getAdminKycTemplate(data: {
    applicationId: string;
    userEmail: string;
    storeName?: string;
  }): string {
    return `
    <!DOCTYPE html>
    <html>
      <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1C341A;">New KYC Application for Review</h2>
        <p>A new seller has submitted their KYC application:</p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Application ID:</strong> ${data.applicationId}</p>
          <p><strong>User Email:</strong> ${data.userEmail}</p>
          ${
            data.storeName
              ? `<p><strong>Store Name:</strong> ${data.storeName}</p>`
              : ""
          }
        </div>
        <p>Please review this application in the admin panel.</p>
      </body>
    </html>
  `;
  }
}

export const emailService = new EmailService();
