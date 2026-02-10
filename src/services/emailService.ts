// src/services/emailService.ts - Updated with Consistent Bidoro Styling
import nodemailer from "nodemailer";

interface EmailVerificationData {
  name: string;
  email: string;
  verificationCode: string;
}

interface PasswordResetData {
  name: string;
  email: string;
  resetCode: string;
}

interface PasswordChangedData {
  name: string;
  email: string;
}

interface ProductSuspensionData {
  name: string;
  email: string;
  productTitle: string;
  reason: string;
  productId: string;
}

interface ProductReactivationData {
  name: string;
  email: string;
  productTitle: string;
  productId: string;
}

interface AccountSuspensionData {
  name: string;
  email: string;
  reason: string;
  suspensionDate: string;
}

interface AccountReactivationData {
  name: string;
  email: string;
}

interface ProductRejectionData {
  name: string;
  email: string;
  productTitle: string;
  reason: string;
  productId: string;
}

class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    // ← Fix: remove the extra 'c'
    console.log("🔍 SMTP Config Check:");
    console.log("User:", process.env.ZEPTOMAIL_USER);
    console.log("Pass exists:", !!process.env.ZEPTOMAIL_PASS);
    console.log("🔍 Auth config being passed to nodemailer:");
    console.log("User:", process.env.ZEPTOMAIL_USER);
    console.log("Pass:", process.env.ZEPTOMAIL_PASS);
    console.log(
      "Pass first 10 chars:",
      process.env.ZEPTOMAIL_PASS?.substring(0, 10),
    );

    // Configure SMTP transporter...
    // Configure SMTP transporter with ZeptoMail and proper TLS settings
    this.transporter = nodemailer.createTransport({
      host: process.env.ZEPTOMAIL_HOST,
      port: parseInt(process.env.ZEPTOMAIL_PORT || "465"),
      secure: true,
      auth: {
        user: process.env.ZEPTOMAIL_USER,
        pass: process.env.ZEPTOMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === "production",
        minVersion: "TLSv1.2",
        ciphers:
          "ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS",
      },
      connectionTimeout: 60000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
      debug: process.env.NODE_ENV === "development",
      logger: process.env.NODE_ENV === "development",
    });

    this.verifyConnection();
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      console.log("✅ ZeptoMail SMTP connection verified successfully");
    } catch (error: any) {
      console.error("❌ Email service configuration error:", error.message);

      if (error.code === "ESOCKET") {
        console.error("🔧 Fix: Check network connection and firewall settings");
      } else if (error.code === "EAUTH") {
        console.error(
          "🔧 Fix: Verify ZEPTOMAIL_USER and ZEPTOMAIL_PASS in .env",
        );
      } else if (error.code === "ECONNECTION") {
        console.error(
          "🔧 Fix: Check ZEPTOMAIL_HOST and ZEPTOMAIL_PORT settings",
        );
      }

      console.warn(
        "⚠️  Email service will retry connection on first send attempt",
      );
    }
  }

  // ============================================================
  // SHARED HEADER TEMPLATE - Used across all emails
  // ============================================================
  private getEmailHeader(
    title: string,
    subtitle: string,
    heroImageUrl?: string,
  ): string {
    return `
    <div style="background: #E8F4A6; padding: 30px 20px; margin: 0; border-radius: 12px 12px 0 0; overflow: hidden;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 100%;">
        <tr>
          <td style="vertical-align: middle; width: 50%;">
            <!-- Logo -->
            <div style="margin-bottom: 15px;">
              <img src="https://blogger.googleusercontent.com/img/a/AVvXsEhujOGbWy47k29NCS2fQ5HLpAVigulEi5U_2rdnwVvq0lPEXtcb8L1q__7raTtq-K-RT9XWzaCXpuwV_8ENa-2FXsgPWUUdEE4WHHFCnc86S2cZAvJaAQL3UOUKxDCMc831PtTWtn3tLg2z4pk4PQtiSxAdERuskZvdRpkPgxnylwgJVO8T4t8UXmCUp0o" 
                   alt="BIDORO" 
                   style="width: 120px; max-width: 100%; height: auto; display: block;">
            </div>
            
            <!-- Title Text -->
            <h1 style="margin: 0 0 8px 0; font-size: 28px; color: #1C341A; font-weight: 700; line-height: 1.2;">
              ${title}
            </h1>
            <p style="margin: 0; font-size: 14px; color: #1C341A; opacity: 0.8;">
              ${subtitle}
            </p>
          </td>
          <td style="vertical-align: middle; width: 50%; text-align: right;">
            <!-- Hero Image -->
            ${
              heroImageUrl
                ? `
            <img src="${heroImageUrl}" 
                 alt="Hero" 
                 style="width: 100%; max-width: 240px; height: auto; display: block; margin-left: auto;">
            `
                : ""
            }
          </td>
        </tr>
      </table>
    </div>
    `;
  }

  // ============================================================
  // SHARED FOOTER TEMPLATE - Used across all emails
  // ============================================================
  private getEmailFooter(): string {
    return `
    <!-- Footer Section -->
    <div style="text-align: center; border-radius: 0 0 12px 12px; background: white;">
      <div style="background: #1C341A; padding: 25px 30px; text-align: center;">
        <p style="font-size: 14px; color: white; margin: 0 0 15px 0;">
          If you have any questions, please visit our <a href="https://bidoro.africa/faq" style="color: #E8F4A6; text-decoration: underline;">FAQ</a> or reach out to <a href="mailto:support@bidoro.africa" style="color: #E8F4A6; text-decoration: underline;">support@bidoro.africa</a>
        </p>
      </div>

      <!-- Social Media Icons -->
      <div style="margin: 20px 0;">
        <a href="https://www.instagram.com/bidoroplug?igsh=YnlubGE1MXZlejcw" style="display: inline-block; margin: 0 8px; text-decoration: none;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#909090" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
        </a>
        <a href="https://x.com/Bidoroplug" style="display: inline-block; margin: 0 8px; text-decoration: none;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#909090" xmlns="http://www.w3.org/2000/svg">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
        <a href="https://facebook.com/bidoro" style="display: inline-block; margin: 0 8px; text-decoration: none;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#909090" xmlns="http://www.w3.org/2000/svg">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
        </a>
        <a href="https://www.tiktok.com/@bidoroplug?_r=1&_t=ZS-92lnuRrCsbt" style="display: inline-block; margin: 0 8px; text-decoration: none;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#909090" xmlns="http://www.w3.org/2000/svg">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
          </svg>
        </a>
        <a href="https://www.linkedin.com/company/bidoroplug/" style="display: inline-block; margin: 0 8px; text-decoration: none;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#909090" xmlns="http://www.w3.org/2000/svg">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
        </a>
        <a href="https://youtube.com/@bidoro" style="display: inline-block; margin: 0 8px; text-decoration: none;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#909090" xmlns="http://www.w3.org/2000/svg">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
        </a>
      </div>

      <p style="font-size: 12px; color: #909090; margin: 15px 0 20px 0; padding-bottom: 10px;">
        ©2025 Bidoro. All Rights Reserved
      </p>
    </div>
    `;
  }

  // ============================================================
  // EMAIL VERIFICATION
  // ============================================================
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

      if (process.env.NODE_ENV === "development") {
        console.log(`📧 Verification email sent to: ${email}`);
        console.log(`🔢 Verification code: ${verificationCode}`);
      }

      return true;
    } catch (error: any) {
      console.error("❌ Verification email sending failed:", error.message);
      return false;
    }
  }

  private getVerificationEmailTemplate(
    name: string,
    verificationCode: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Verify Your Email", "Secure your BIDORO account", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <!-- Greeting -->
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${name}</strong>,
            </p>

            <!-- Welcome Message -->
            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Almost there! Just one more step to activate your account and start your marketplace journey.
            </p>

            <!-- Verification Code Section -->
            <div style="text-align: center; margin: 35px 0;">
              <h3 style="color: #1C341A; margin: 0 0 20px 0; font-size: 22px;">
                🔑 Your Verification Code
              </h3>
              
              <!-- Code Display -->
              <div style="border: 3px solid #1C341A; padding: 30px; border-radius: 15px; margin: 20px 0; background: #F6F5FA;">
                <div style="font-size: 48px; font-weight: bold; color: #1C341A; letter-spacing: 12px; font-family: 'Courier New', monospace;">
                  ${verificationCode}
                </div>
                <p style="margin: 15px 0 0 0; color: #1C341A; font-size: 14px; font-weight: 600;">
                  Enter this code to verify your account
                </p>
              </div>
            </div>

            <!-- Instructions -->
            <div style="margin: 35px 0;">
              <div style="background: #F6F5FA; padding: 20px; border-radius: 12px;">
                <h4 style="color: #1C341A; margin: 0 0 15px 0; font-size: 18px;">📋 How to verify:</h4>
                <ol style="margin: 0; padding-left: 20px; color: #333; line-height: 1.6;">
                  <li style="margin-bottom: 8px;">Return to the verification page on BIDORO</li>
                  <li style="margin-bottom: 8px;">Enter the 4-digit code shown above</li>
                  <li style="margin-bottom: 8px;">Click "Verify Email" to activate your account</li>
                </ol>
              </div>
            </div>

            <!-- Security Warning -->
            <div style="background: #FFF9E6; border: 2px solid #F5C842; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.5;">
                ⚠️ <strong>Important:</strong> This verification code will expire in <strong>10 minutes</strong> for your security. If you didn't create a BIDORO account, please ignore this email.
              </p>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="https://bidoro.africa/verify" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Verify My Email
              </a>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              We're excited to have you join the BIDORO community!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // WELCOME EMAIL
  // ============================================================
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
          <title>Welcome to Bidoro</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Welcome to Bidoro", "Your marketplace journey begins now!", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <!-- Greeting -->
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${name}</strong>,
            </p>

            <!-- Welcome Message -->
            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Congratulations! Your BIDORO account is now fully activated. You can explore Nigeria's premier marketplace and connect with trusted buyers and sellers.
            </p>

            <!-- Features Section -->
            <div style="margin: 30px 0;">
              
              <!-- Feature 1: Browse and Buy -->
              <div style="margin-bottom: 20px; display: table; width: 100%; background-color: #F6F5FA; padding: 10px; border-radius: 10px;">
                <div style="display: table-cell; vertical-align: top; width: 70px;">
                  <img src="https://res.cloudinary.com/dijpe53kr/image/upload/v1770649552/Group_39928_eojnaa.png" 
                       alt="Browse and Buy" 
                       style="width: 60px; height: 60px; display: block;">
                </div>
                <div style="display: table-cell; vertical-align: middle; padding-left: 15px;">
                  <h3 style="margin: 0 0 5px 0; font-size: 18px; color: #1C341A; font-weight: 600;">Browse and Buy</h3>
                  <p style="margin: 0; font-size: 14px; color: #666; line-height: 1.4;">Discover thousands of verified products and services</p>
                </div>
              </div>

              <!-- Feature 2: Start Selling -->
              <div style="margin-bottom: 20px; display: table; width: 100%; background-color: #F6F5FA; padding: 10px; border-radius: 10px;">
                <div style="display: table-cell; vertical-align: top; width: 70px;">
                  <img src="https://res.cloudinary.com/dijpe53kr/image/upload/v1770649623/Group_39928_1_ngxzrh.png" 
                       alt="Start Selling" 
                       style="width: 60px; height: 60px; display: block;">
                </div>
                <div style="display: table-cell; vertical-align: middle; padding-left: 15px;">
                  <h3 style="margin: 0 0 5px 0; font-size: 18px; color: #1C341A; font-weight: 600;">Start Selling</h3>
                  <p style="margin: 0; font-size: 14px; color: #666; line-height: 1.4;">List your products with our easy-to-use tools</p>
                </div>
              </div>

              <!-- Feature 3: Secure Transactions -->
              <div style="margin-bottom: 20px; display: table; width: 100%; background-color: #F6F5FA; padding: 10px; border-radius: 10px;">
                <div style="display: table-cell; vertical-align: top; width: 70px;">
                  <img src="https://res.cloudinary.com/dijpe53kr/image/upload/v1770649648/Group_39928_2_tckixv.png" 
                       alt="Secure Transactions" 
                       style="width: 60px; height: 60px; display: block;">
                </div>
                <div style="display: table-cell; vertical-align: middle; padding-left: 15px;">
                  <h3 style="margin: 0 0 5px 0; font-size: 18px; color: #1C341A; font-weight: 600;">Secure Transactions</h3>
                  <p style="margin: 0; font-size: 14px; color: #666; line-height: 1.4;">Enjoy protected payments with our escrow system</p>
                </div>
              </div>

              <!-- Feature 4: Trusted Community -->
              <div style="margin-bottom: 20px; display: table; width: 100%; background-color: #F6F5FA; padding: 10px; border-radius: 10px;">
                <div style="display: table-cell; vertical-align: top; width: 70px;">
                  <img src="https://res.cloudinary.com/dijpe53kr/image/upload/v1770649669/Group_39928_3_eyfp0i.png" 
                       alt="Trusted Community" 
                       style="width: 60px; height: 60px; display: block;">
                </div>
                <div style="display: table-cell; vertical-align: middle; padding-left: 15px;">
                  <h3 style="margin: 0 0 5px 0; font-size: 18px; color: #1C341A; font-weight: 600;">Trusted Community</h3>
                  <p style="margin: 0; font-size: 14px; color: #666; line-height: 1.4;">Connect with verified sellers and buyers</p>
                </div>
              </div>

            </div>

            <!-- Call to Action Button -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://bidoro.africa/" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Start Exploring
              </a>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Your account is now active and ready to use. You can start exploring Bidoro to make your first purchase
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // PASSWORD RESET
  // ============================================================
  async sendPasswordResetEmail(data: PasswordResetData): Promise<boolean> {
    try {
      const { name, email, resetCode } = data;

      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: email,
        subject: "Reset Your Password - BIDORO 🔐",
        html: this.getPasswordResetTemplate(name, resetCode),
        text: `Hi ${name},\n\nYour password reset code is: ${resetCode}\n\nThis code will expire in 10 minutes.\n\nIf you didn't request this, please ignore this email.\n\nBest regards,\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(
        "✅ Password reset email sent successfully:",
        result.messageId,
      );

      if (process.env.NODE_ENV === "development") {
        console.log(`📧 Password reset email sent to: ${email}`);
        console.log(`🔢 Reset code: ${resetCode}`);
      }

      return true;
    } catch (error: any) {
      console.error("❌ Password reset email sending failed:", error.message);
      return false;
    }
  }

  private getPasswordResetTemplate(name: string, resetCode: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Reset Your Password", "Secure your BIDORO account", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <!-- Greeting -->
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${name}</strong>,
            </p>

            <!-- Info Message -->
            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              We received a request to reset your password. Use the code below to reset your password. If you didn't request this, you can safely ignore this email.
            </p>

            <!-- Reset Code Section -->
            <div style="text-align: center; margin: 35px 0;">
              <h3 style="color: #1C341A; margin: 0 0 20px 0; font-size: 22px;">
                🔑 Your Reset Code
              </h3>
              
              <!-- Code Display -->
              <div style="border: 3px solid #1C341A; padding: 30px; border-radius: 15px; margin: 20px 0; background: #F6F5FA;">
                <div style="font-size: 48px; font-weight: bold; color: #1C341A; letter-spacing: 12px; font-family: 'Courier New', monospace;">
                  ${resetCode}
                </div>
                <p style="margin: 15px 0 0 0; color: #1C341A; font-size: 14px; font-weight: 600;">
                  Enter this code to reset your password
                </p>
              </div>
            </div>

            <!-- Instructions -->
            <div style="margin: 35px 0;">
              <div style="background: #F6F5FA; padding: 20px; border-radius: 12px;">
                <h4 style="color: #1C341A; margin: 0 0 15px 0; font-size: 18px;">📋 How to reset:</h4>
                <ol style="margin: 0; padding-left: 20px; color: #333; line-height: 1.6;">
                  <li style="margin-bottom: 8px;">Return to the password reset page on BIDORO</li>
                  <li style="margin-bottom: 8px;">Enter the 4-digit code shown above</li>
                  <li style="margin-bottom: 8px;">Create your new password</li>
                </ol>
              </div>
            </div>

            <!-- Security Warning -->
            <div style="background: #FFF9E6; border: 2px solid #F5C842; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.5;">
                ⚠️ <strong>Important:</strong> This reset code will expire in <strong>10 minutes</strong> for your security. If you didn't request a password reset, please ignore this email and your password will remain unchanged.
              </p>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Stay safe and secure on BIDORO!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // PASSWORD CHANGED CONFIRMATION
  // ============================================================
  async sendPasswordChangedEmail(data: PasswordChangedData): Promise<boolean> {
    try {
      const { name, email } = data;

      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: email,
        subject: "Password Changed Successfully - BIDORO ✅",
        html: this.getPasswordChangedTemplate(name),
        text: `Hi ${name},\n\nYour password has been changed successfully.\n\nIf you didn't make this change, please contact us immediately at hello@bidoro.africa.\n\nBest regards,\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(
        "✅ Password changed email sent successfully:",
        result.messageId,
      );
      return true;
    } catch (error: any) {
      console.error("❌ Password changed email sending failed:", error.message);
      return false;
    }
  }

  private getPasswordChangedTemplate(name: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Changed - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Password Changed", "Your account security has been updated", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <!-- Success Message -->
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="display: inline-block; width: 60px; height: 60px; background: #22c55e; border-radius: 50%; margin-bottom: 20px;">
                <span style="display: block; padding-top: 12px; color: white; font-size: 35px; font-weight: bold;">✓</span>
              </div>
            </div>

            <!-- Greeting -->
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Your BIDORO account password was updated successfully. You can now log in with your new password.
            </p>

            <!-- Security Warning -->
            <div style="background: #FEE2E2; border: 2px solid #EF4444; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.5;">
                🚨 <strong>Didn't make this change?</strong><br><br>
                If you didn't change your password, please contact us immediately at <a href="mailto:hello@bidoro.africa" style="color: #dc2626; font-weight: 600;">hello@bidoro.africa</a> to secure your account.
              </p>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Stay safe and secure on BIDORO!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // KYC SUBMISSION CONFIRMATION
  // ============================================================
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
        result.messageId,
      );
      return true;
    } catch (error: any) {
      console.error("❌ KYC submission email failed:", error.message);
      return false;
    }
  }

  private getKycSubmissionTemplate(data: {
    name: string;
    applicationId: string;
    storeName?: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>KYC Application Submitted - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("KYC Application Submitted", "We're reviewing your seller application", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Your KYC application has been submitted successfully and is now under review.
            </p>

            <!-- Application Info -->
            <div style="background: #F6F5FA; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Application ID:</strong> ${data.applicationId}</p>
              ${data.storeName ? `<p style="margin: 0;"><strong>Store Name:</strong> ${data.storeName}</p>` : ""}
            </div>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              We'll review your application within 2-3 business days and notify you of the outcome.
            </p>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Thank you for choosing to sell on BIDORO!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // KYC APPROVAL
  // ============================================================
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
        text: `Hi ${data.name},\n\nGreat news! Your KYC application has been approved.\n${data.storeName ? `Your store "${data.storeName}" is now active.` : ""}\n\nYou can now start selling on BIDORO.\n\nBest regards,\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ KYC approval email sent successfully:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ KYC approval email failed:", error.message);
      return false;
    }
  }

  private getKycApprovalTemplate(data: {
    name: string;
    storeName?: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>KYC Approved - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("KYC Application Approved!", "Welcome to BIDORO Sellers", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <!-- Success Message -->
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="display: inline-block; width: 60px; height: 60px; background: #22c55e; border-radius: 50%; margin-bottom: 20px;">
                <span style="display: block; padding-top: 12px; color: white; font-size: 35px; font-weight: bold;">✓</span>
              </div>
            </div>

            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Congratulations! Your KYC application has been approved.
              ${data.storeName ? `Your store "<strong>${data.storeName}</strong>" is now active and ready for customers!` : ""}
            </p>

            <!-- What's Next -->
            <div style="background: #F6F5FA; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <h3 style="margin: 0 0 15px 0; font-size: 18px; color: #1C341A;">You can now:</h3>
              <ul style="margin: 0; padding-left: 20px; color: #333; line-height: 1.8;">
                <li>List products for sale</li>
                <li>Manage your store profile</li>
                <li>Start receiving orders</li>
              </ul>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://bidoro.africa/seller/dashboard" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Go to Seller Dashboard
              </a>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Welcome to the BIDORO seller community!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // KYC REJECTION
  // ============================================================
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
        result.messageId,
      );
      return true;
    } catch (error: any) {
      console.error("❌ KYC rejection email failed:", error.message);
      return false;
    }
  }

  private getKycRejectionTemplate(data: {
    name: string;
    reason: string;
    applicationId: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>KYC Application Update Required - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("KYC Application Update Required", "Please review and resubmit", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Your KYC application requires updates before it can be approved.
            </p>

            <!-- Issue -->
            <div style="background: #FEE2E2; border-left: 4px solid #EF4444; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0; font-weight: 600; color: #991b1b;">Issue:</p>
              <p style="margin: 0; color: #991b1b;">${data.reason}</p>
            </div>

            <p style="font-size: 16px; color: #333; margin: 25px 0; line-height: 1.6;">
              Please update your application and resubmit for review.
            </p>

            <p style="font-size: 14px; color: #666; margin: 0;">
              <strong>Application ID:</strong> ${data.applicationId}
            </p>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://bidoro.africa/seller/kyc" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Update Application
              </a>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              We're here to help if you have any questions
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // ADMIN KYC NOTIFICATION
  // ============================================================
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
        text: `New KYC Application\n\nApplication ID: ${data.applicationId}\nUser: ${data.userEmail}\n${data.storeName ? `Store: ${data.storeName}` : ""}\n\nPlease review in admin panel.`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log(
        "✅ Admin KYC notification sent successfully:",
        result.messageId,
      );
      return true;
    } catch (error: any) {
      console.error("❌ Admin KYC notification failed:", error.message);
      return false;
    }
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
            ${data.storeName ? `<p><strong>Store Name:</strong> ${data.storeName}</p>` : ""}
          </div>
          <p>Please review this application in the admin panel.</p>
        </body>
      </html>
    `;
  }

  // ============================================================
  // ORDER CONFIRMATION (BUYER)
  // ============================================================
  async sendOrderConfirmationEmail(data: {
    name: string;
    email: string;
    orderNumber: string;
    totalAmount: number;
    items: any[];
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: `Order Confirmed - ${data.orderNumber} 🎉`,
        html: this.getOrderConfirmationTemplate(data),
        text: `Hi ${data.name},\n\nYour order ${data.orderNumber} has been confirmed!\n\nTotal: ₦${data.totalAmount.toLocaleString()}\n\nYour payment is held securely in escrow until you confirm delivery.\n\nThank you for shopping with BIDORO!`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Order confirmation email sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Order confirmation email failed:", error.message);
      return false;
    }
  }

  private getOrderConfirmationTemplate(data: {
    name: string;
    orderNumber: string;
    totalAmount: number;
    items: any[];
  }): string {
    const itemsList = data.items
      .map(
        (item) => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.product_name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">₦${(item.subtotal || item.total_price || 0).toLocaleString()}</td>
      </tr>
    `,
      )
      .join("");

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Order Confirmed - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Order Confirmed!", "Your purchase is being prepared", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Great news! Your order has been confirmed and your payment is secured.
            </p>

            <!-- Order Info -->
            <div style="background: #F6F5FA; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Order Number:</strong> ${data.orderNumber}</p>
              <p style="margin: 0;"><strong>Total Amount:</strong> ₦${data.totalAmount.toLocaleString()}</p>
            </div>

            <!-- Items Table -->
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <thead>
                <tr style="background: #F6F5FA;">
                  <th style="padding: 10px; text-align: left; border-bottom: 2px solid #1C341A;">Item</th>
                  <th style="padding: 10px; text-align: center; border-bottom: 2px solid #1C341A;">Qty</th>
                  <th style="padding: 10px; text-align: right; border-bottom: 2px solid #1C341A;">Price</th>
                </tr>
              </thead>
              <tbody>
                ${itemsList}
              </tbody>
            </table>

            <!-- Escrow Notice -->
            <div style="background: #E8F5E9; border-left: 4px solid #4CAF50; padding: 15px; border-radius: 8px; margin: 25px 0;">
              <p style="margin: 0; color: #1B5E20; font-size: 14px;">
                🔒 <strong>Escrow Protection:</strong> Your payment is held securely until you confirm delivery of your items.
              </p>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://bidoro.africa/orders" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View My Orders
              </a>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Thank you for shopping with BIDORO!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // NEW ORDER NOTIFICATION (SELLER)
  // ============================================================
  async sendNewOrderNotificationEmail(data: {
    name: string;
    email: string;
    orderNumber: string;
    buyerName: string;
    amount: number;
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: `New Order Received - ${data.orderNumber} 💰`,
        html: this.getNewOrderNotificationTemplate(data),
        text: `Hi ${data.name},\n\nYou have a new order!\n\nOrder: ${data.orderNumber}\nBuyer: ${data.buyerName}\nAmount: ₦${data.amount.toLocaleString()}\n\nPlease prepare the item(s) for delivery.\n\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Seller notification email sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Seller notification email failed:", error.message);
      return false;
    }
  }

  private getNewOrderNotificationTemplate(data: {
    name: string;
    orderNumber: string;
    buyerName: string;
    amount: number;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>New Order Received - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("New Order! 💰", "You have a new sale", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Great news! You have received a new order.
            </p>

            <!-- Order Info -->
            <div style="background: #F6F5FA; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Order Number:</strong> ${data.orderNumber}</p>
              <p style="margin: 0 0 10px 0;"><strong>Buyer:</strong> ${data.buyerName}</p>
              <p style="margin: 0;"><strong>Your Earnings:</strong> ₦${data.amount.toLocaleString()}</p>
            </div>

            <!-- Action Required -->
            <div style="background: #FFF9E6; border-left: 4px solid #F5C842; padding: 15px; border-radius: 8px; margin: 25px 0;">
              <p style="margin: 0; color: #856404; font-size: 14px;">
                ⚠️ Please prepare the item(s) and arrange delivery/pickup with the buyer.
              </p>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://bidoro.africa/seller/orders" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View Order Details
              </a>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Thank you for selling on BIDORO!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // CONTACT FORM CONFIRMATION
  // ============================================================
  async sendContactConfirmationEmail(data: {
    name: string;
    email: string;
    messageId: string;
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "We've Received Your Message - BIDORO ✅",
        html: this.getContactConfirmationTemplate(data),
        text: `Hi ${data.name},\n\nThank you for contacting BIDORO!\n\nWe've received your message and will respond within 24-48 hours.\n\nReference ID: ${data.messageId}\n\nBest regards,\nBIDORO Support Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Contact confirmation email sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Contact confirmation email failed:", error.message);
      return false;
    }
  }

  private getContactConfirmationTemplate(data: {
    name: string;
    messageId: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Message Received - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Message Received! ✅", "We'll get back to you soon", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <!-- Success Message -->
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="display: inline-block; width: 60px; height: 60px; background: #22c55e; border-radius: 50%; margin-bottom: 20px;">
                <span style="display: block; padding-top: 12px; color: white; font-size: 35px; font-weight: bold;">✓</span>
              </div>
            </div>

            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Thank you for reaching out to BIDORO! We've successfully received your message.
            </p>

            <!-- Reference Info -->
            <div style="background: #F6F5FA; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0;"><strong>Reference ID:</strong> ${data.messageId}</p>
              <p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">Please keep this for your records</p>
            </div>

            <!-- What's Next -->
            <div style="background: #E8F5E9; border-left: 4px solid #4CAF50; padding: 15px; border-radius: 8px; margin: 25px 0;">
              <h3 style="margin: 0 0 10px 0; color: #1B5E20; font-size: 16px;">📋 What happens next?</h3>
              <ul style="margin: 0; padding-left: 20px; color: #1B5E20; line-height: 1.8;">
                <li>Our support team will review your message</li>
                <li>We'll respond within 24-48 hours</li>
                <li>You'll receive our reply at this email address</li>
              </ul>
            </div>

            <!-- Business Hours -->
            <div style="background: #FFF9E6; border-left: 4px solid #F5C842; padding: 15px; border-radius: 8px; margin: 25px 0;">
              <p style="margin: 0; color: #856404; font-size: 14px;">
                <strong>⏰ Support Hours:</strong><br>
                Monday - Friday: 8:00 AM - 6:00 PM WAT<br>
                Saturday: 9:00 AM - 4:00 PM WAT<br>
                Sunday: Closed
              </p>
            </div>

            <!-- Account Active Message -->
            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              We appreciate your patience and look forward to assisting you!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // ADMIN CONTACT NOTIFICATION
  // ============================================================
  async sendAdminContactNotification(data: {
    name: string;
    email: string;
    phone: string;
    subject: string;
    message: string;
    messageId: string;
  }): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: process.env.ADMIN_EMAIL || "admin@bidoro.africa",
        subject: `New Contact Message: ${data.subject} 📨`,
        html: this.getAdminContactNotificationTemplate(data),
        text: `New Contact Message\n\nFrom: ${data.name} (${data.email})\nPhone: ${data.phone}\nSubject: ${data.subject}\n\nMessage:\n${data.message}\n\nID: ${data.messageId}`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Admin contact notification sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Admin contact notification failed:", error.message);
      return false;
    }
  }

  private getAdminContactNotificationTemplate(data: {
    name: string;
    email: string;
    phone: string;
    subject: string;
    message: string;
    messageId: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #1C341A; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0;">New Contact Message 📨</h1>
          </div>
          <div style="background: white; padding: 30px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <p style="margin: 0 0 10px 0;"><strong>From:</strong> ${data.name}</p>
              <p style="margin: 0 0 10px 0;"><strong>Email:</strong> <a href="mailto:${data.email}">${data.email}</a></p>
              <p style="margin: 0 0 10px 0;"><strong>Phone:</strong> ${data.phone}</p>
              <p style="margin: 0 0 10px 0;"><strong>Subject:</strong> ${data.subject}</p>
              <p style="margin: 0;"><strong>Message ID:</strong> ${data.messageId}</p>
            </div>

            <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 10px 0; color: #856404;">Message:</h3>
              <p style="margin: 0; color: #856404; white-space: pre-wrap;">${data.message}</p>
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://bidoro.africa/admin/contact/${data.messageId}" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                View & Respond
              </a>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  // ============================================================
// ADD THESE METHODS inside the EmailService class
// ============================================================

  // ============================================================
  // PRODUCT SUSPENDED (Notify Seller)
  // ============================================================
  async sendProductSuspendedEmail(data: ProductSuspensionData): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "Product Listing Suspended - BIDORO ⚠️",
        html: this.getProductSuspendedTemplate(data),
        text: `Hi ${data.name},\n\nYour product listing "${data.productTitle}" has been suspended.\n\nReason: ${data.reason}\n\nPlease review and update your listing to comply with our guidelines.\n\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Product suspension email sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Product suspension email failed:", error.message);
      return false;
    }
  }

  private getProductSuspendedTemplate(data: ProductSuspensionData): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Product Suspended - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Product Listing Suspended", "Action required on your listing", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              We're writing to let you know that your product listing has been suspended by our moderation team.
            </p>

            <!-- Product Info -->
            <div style="background: #F6F5FA; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Product:</strong> ${data.productTitle}</p>
              <p style="margin: 0;"><strong>Product ID:</strong> ${data.productId}</p>
            </div>

            <!-- Reason -->
            <div style="background: #FEE2E2; border-left: 4px solid #EF4444; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0; font-weight: 600; color: #991b1b;">Reason for suspension:</p>
              <p style="margin: 0; color: #991b1b; line-height: 1.6;">${data.reason}</p>
            </div>

            <!-- What To Do -->
            <div style="margin: 30px 0;">
              <div style="background: #F6F5FA; padding: 20px; border-radius: 12px;">
                <h4 style="color: #1C341A; margin: 0 0 15px 0; font-size: 18px;">📋 What you can do:</h4>
                <ol style="margin: 0; padding-left: 20px; color: #333; line-height: 1.8;">
                  <li style="margin-bottom: 8px;">Review the reason for suspension above</li>
                  <li style="margin-bottom: 8px;">Update your listing to comply with our <a href="https://bidoro.africa/guidelines" style="color: #1C341A; font-weight: 600;">Community Guidelines</a></li>
                  <li style="margin-bottom: 8px;">Contact support if you believe this was a mistake</li>
                </ol>
              </div>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://bidoro.africa/seller/products" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View My Products
              </a>
            </div>

            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              If you have questions, please reach out to our support team.
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // PRODUCT REACTIVATED (Notify Seller)
  // ============================================================
  async sendProductReactivatedEmail(data: ProductReactivationData): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "Product Listing Reactivated - BIDORO ✅",
        html: this.getProductReactivatedTemplate(data),
        text: `Hi ${data.name},\n\nGreat news! Your product listing "${data.productTitle}" has been reactivated and is now visible to buyers.\n\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Product reactivation email sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Product reactivation email failed:", error.message);
      return false;
    }
  }

  private getProductReactivatedTemplate(data: ProductReactivationData): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Product Reactivated - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Product Reactivated!", "Your listing is live again", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <!-- Success Icon -->
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="display: inline-block; width: 60px; height: 60px; background: #22c55e; border-radius: 50%; margin-bottom: 20px;">
                <span style="display: block; padding-top: 12px; color: white; font-size: 35px; font-weight: bold;">✓</span>
              </div>
            </div>

            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              Great news! Your product listing has been reviewed and reactivated. It is now visible to buyers on BIDORO.
            </p>

            <!-- Product Info -->
            <div style="background: #E8F5E9; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0; color: #1B5E20;"><strong>Product:</strong> ${data.productTitle}</p>
              <p style="margin: 0; color: #1B5E20;"><strong>Status:</strong> Active ✅</p>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://bidoro.africa/seller/products" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View My Products
              </a>
            </div>

            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Thank you for being a trusted seller on BIDORO!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // PRODUCT REJECTED (Notify Seller - for flagged/reported products)
  // ============================================================
  async sendProductRejectedEmail(data: ProductRejectionData): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "Product Listing Removed - BIDORO",
        html: this.getProductRejectedTemplate(data),
        text: `Hi ${data.name},\n\nYour product listing "${data.productTitle}" has been removed from BIDORO.\n\nReason: ${data.reason}\n\nIf you believe this was a mistake, please contact support.\n\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Product rejection email sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Product rejection email failed:", error.message);
      return false;
    }
  }

  private getProductRejectedTemplate(data: ProductRejectionData): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Product Removed - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Product Listing Removed", "Your listing has been taken down", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              After review, your product listing has been permanently removed from BIDORO for violating our marketplace guidelines.
            </p>

            <!-- Product Info -->
            <div style="background: #F6F5FA; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0;"><strong>Product:</strong> ${data.productTitle}</p>
              <p style="margin: 0;"><strong>Product ID:</strong> ${data.productId}</p>
            </div>

            <!-- Reason -->
            <div style="background: #FEE2E2; border-left: 4px solid #EF4444; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <p style="margin: 0 0 10px 0; font-weight: 600; color: #991b1b;">Reason for removal:</p>
              <p style="margin: 0; color: #991b1b; line-height: 1.6;">${data.reason}</p>
            </div>

            <!-- Warning -->
            <div style="background: #FFF9E6; border: 2px solid #F5C842; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.5;">
                ⚠️ <strong>Please note:</strong> Repeated violations of our guidelines may result in account suspension. Please review our <a href="https://bidoro.africa/guidelines" style="color: #856404; font-weight: 600;">Community Guidelines</a> before listing new products.
              </p>
            </div>

            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              If you believe this was a mistake, contact us at <a href="mailto:support@bidoro.africa" style="color: #1C341A;">support@bidoro.africa</a>
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // ACCOUNT SUSPENDED (Notify User)
  // ============================================================
  async sendAccountSuspendedEmail(data: AccountSuspensionData): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "Account Suspended - BIDORO ⚠️",
        html: this.getAccountSuspendedTemplate(data),
        text: `Hi ${data.name},\n\nYour BIDORO account has been suspended.\n\nReason: ${data.reason}\n\nEffective: ${data.suspensionDate}\n\nPlease contact support if you believe this was an error.\n\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Account suspension email sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Account suspension email failed:", error.message);
      return false;
    }
  }

  private getAccountSuspendedTemplate(data: AccountSuspensionData): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Account Suspended - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Account Suspended", "Important notice about your account", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              We regret to inform you that your BIDORO account has been suspended due to a violation of our terms of service.
            </p>

            <!-- Suspension Details -->
            <div style="background: #FEE2E2; border: 2px solid #EF4444; padding: 25px; border-radius: 12px; margin: 25px 0;">
              <h3 style="margin: 0 0 15px 0; color: #991b1b; font-size: 18px;">🚫 Suspension Details</h3>
              <table style="width: 100%;">
                <tr>
                  <td style="padding: 8px 0; color: #991b1b; font-weight: 600; vertical-align: top; width: 120px;">Reason:</td>
                  <td style="padding: 8px 0; color: #991b1b;">${data.reason}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #991b1b; font-weight: 600; vertical-align: top;">Effective:</td>
                  <td style="padding: 8px 0; color: #991b1b;">${data.suspensionDate}</td>
                </tr>
              </table>
            </div>

            <!-- What This Means -->
            <div style="margin: 30px 0;">
              <div style="background: #F6F5FA; padding: 20px; border-radius: 12px;">
                <h4 style="color: #1C341A; margin: 0 0 15px 0; font-size: 18px;">What this means:</h4>
                <ul style="margin: 0; padding-left: 20px; color: #333; line-height: 1.8;">
                  <li style="margin-bottom: 8px;">You cannot log in to your account</li>
                  <li style="margin-bottom: 8px;">All your active listings have been hidden</li>
                  <li style="margin-bottom: 8px;">Pending transactions will be handled by our support team</li>
                </ul>
              </div>
            </div>

            <!-- Appeal Info -->
            <div style="background: #E8F5E9; border-left: 4px solid #4CAF50; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <h4 style="margin: 0 0 10px 0; color: #1B5E20; font-size: 16px;">📩 Think this is a mistake?</h4>
              <p style="margin: 0; color: #1B5E20; font-size: 14px; line-height: 1.6;">
                You can appeal this decision by contacting our support team at <a href="mailto:support@bidoro.africa" style="color: #1B5E20; font-weight: 600;">support@bidoro.africa</a>. Please include your account email and any relevant details.
              </p>
            </div>

            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              We take the safety of our community seriously and appreciate your understanding.
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  // ============================================================
  // ACCOUNT REACTIVATED (Notify User)
  // ============================================================
  async sendAccountReactivatedEmail(data: AccountReactivationData): Promise<boolean> {
    try {
      const mailOptions = {
        from: {
          name: process.env.EMAIL_FROM_NAME || "BIDORO",
          address: process.env.EMAIL_FROM || "hello@bidoro.africa",
        },
        to: data.email,
        subject: "Account Reactivated - Welcome Back to BIDORO! ✅",
        html: this.getAccountReactivatedTemplate(data),
        text: `Hi ${data.name},\n\nGreat news! Your BIDORO account has been reactivated.\n\nYou can now log in and use all features as before.\n\nBIDORO Team`,
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log("✅ Account reactivation email sent:", result.messageId);
      return true;
    } catch (error: any) {
      console.error("❌ Account reactivation email failed:", error.message);
      return false;
    }
  }

  private getAccountReactivatedTemplate(data: AccountReactivationData): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Account Reactivated - BIDORO</title>
        </head>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 0; background-color: #f5f5f5;">
          
          ${this.getEmailHeader("Welcome Back!", "Your account has been reactivated", "https://res.cloudinary.com/dijpe53kr/image/upload/v1770650425/Group_40011_zyvt7m.png")}

          <!-- Main Content Card -->
          <div style="background: white; margin: 0; padding: 35px 30px;">
            
            <!-- Success Icon -->
            <div style="text-align: center; margin-bottom: 30px;">
              <div style="display: inline-block; width: 60px; height: 60px; background: #22c55e; border-radius: 50%; margin-bottom: 20px;">
                <span style="display: block; padding-top: 12px; color: white; font-size: 35px; font-weight: bold;">✓</span>
              </div>
            </div>

            <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
              Hello <strong>${data.name}</strong>,
            </p>

            <p style="font-size: 16px; color: #333; margin: 0 0 25px 0; line-height: 1.6;">
              We're happy to let you know that your BIDORO account has been reactivated. You now have full access to all features.
            </p>

            <!-- What's Restored -->
            <div style="background: #E8F5E9; padding: 20px; border-radius: 10px; margin: 25px 0;">
              <h3 style="margin: 0 0 15px 0; color: #1B5E20; font-size: 16px;">✅ Your access has been restored:</h3>
              <ul style="margin: 0; padding-left: 20px; color: #1B5E20; line-height: 1.8;">
                <li>Log in to your account</li>
                <li>View and manage your listings</li>
                <li>Buy and sell on the marketplace</li>
                <li>Access your order history</li>
              </ul>
            </div>

            <!-- Reminder -->
            <div style="background: #FFF9E6; border: 2px solid #F5C842; padding: 20px; border-radius: 12px; margin: 30px 0;">
              <p style="margin: 0; color: #856404; font-size: 14px; line-height: 1.5;">
                ⚠️ <strong>Reminder:</strong> Please ensure all future activity complies with our <a href="https://bidoro.africa/terms" style="color: #856404; font-weight: 600;">Terms of Service</a> and <a href="https://bidoro.africa/guidelines" style="color: #856404; font-weight: 600;">Community Guidelines</a> to avoid further account actions.
              </p>
            </div>

            <!-- Call to Action -->
            <div style="text-align: center; margin: 35px 0;">
              <a href="https://bidoro.africa/login" 
                 style="display: inline-block; background: #1C341A; color: white; padding: 14px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Log In Now
              </a>
            </div>

            <p style="font-size: 14px; color: #666; margin: 30px 0 0 0; text-align: center; line-height: 1.5;">
              Welcome back to the BIDORO community!
            </p>

          </div>

          ${this.getEmailFooter()}

        </body>
      </html>
    `;
  }

  
}

export const emailService = new EmailService();
