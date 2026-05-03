import { Injectable, Logger, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User, IUser } from '../../models/User.model';
import { Session, ISession } from '../../models/Session.model';
import { EmailService } from '../../services/email.service';
import { SmsService } from '../../services/sms.service';
import { parseDeviceInfo } from '../../utils/deviceParser';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Session') private sessionModel: Model<ISession>,
    private jwtService: JwtService,
    private emailService: EmailService,
    private smsService: SmsService,
  ) {}

  async register(registerDto: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    role?: string;
  }) {
    const { name, email, password, phone, role } = registerDto;

    // Check if user exists
    const userExists = await this.userModel.findOne({ email });
    if (userExists) {
      throw new BadRequestException('User already exists');
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await this.userModel.create({
      name,
      email,
      password: hashedPassword,
      role: role || 'customer',
      emailVerified: false,
    });

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpire = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await user.save();

    try {
      await this.emailService.sendVerificationEmail(email, verificationToken);
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error: any) {
      // Don't fail registration if email fails — but record it.
      this.logger.error(`Failed to send verification email to ${email}: ${error.message || error}`);
    }

    return {
      success: true,
      message: 'User registered successfully. Please verify your email.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async registerSeller(sellerData: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    businessName?: string;
    businessAddress?: string;
    taxId?: string;
    documents?: {
      businessLicense?: string;
      taxDocument?: string;
      idDocument?: string;
    };
  }) {
    const { name, email, password, phone, businessName, businessAddress, taxId, documents } = sellerData;

    // Check if user exists
    const userExists = await this.userModel.findOne({ email });
    if (userExists) {
      throw new BadRequestException('User already exists');
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create seller user (pending approval)
    const user = await this.userModel.create({
      name,
      email,
      password: hashedPassword,
      phone,
      role: 'seller',
      status: 'inactive', // Seller needs admin approval
      emailVerified: false,
      // Store seller-specific data in a separate field (can be extended to a Seller model later)
      sellerInfo: {
        businessName,
        businessAddress,
        taxId,
        documents,
        approvalStatus: 'pending',
        submittedAt: new Date(),
      },
    });

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpire = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    try {
      await this.emailService.sendVerificationEmail(email, verificationToken);
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error: any) {
      this.logger.error(`Failed to send verification email to ${email}: ${error.message || error}`);
    }

    // Notify admin about new seller registration
    try {
      const adminUsers = await this.userModel.find({ role: 'admin' }).select('email name');
      // The .filter narrows string|undefined to string for the type checker.
      const adminEmails: string[] = adminUsers
        .map(admin => admin.email)
        .filter((email): email is string => typeof email === 'string' && email.length > 0);
      
      if (adminEmails.length > 0 && this.emailService) {
        const adminNotificationHtml = `
          <h1>New Seller Registration</h1>
          <p>A new seller has registered and is pending approval:</p>
          <ul>
            <li><strong>Name:</strong> ${name}</li>
            <li><strong>Email:</strong> ${email}</li>
            <li><strong>Business Name:</strong> ${businessName || 'N/A'}</li>
          </ul>
          <p><a href="${process.env.FRONTEND_URL}/admin/sellers">Review Seller Applications</a></p>
        `;
        
        // Send to all admins
        await Promise.all(adminEmails.map(adminEmail => 
          this.emailService.sendEmail({
            to: adminEmail,
            subject: 'New Seller Registration - Pending Approval',
            html: adminNotificationHtml,
          }).catch((err) => {
            this.logger.error(`Failed to send notification to ${adminEmail}: ${err?.message || err}`);
          })
        ));
      }
    } catch (error: any) {
      this.logger.error(`Error sending admin notification: ${error?.message || error}`);
    }

    return {
      success: true,
      message: 'Seller registration submitted successfully. Your account is pending admin approval.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    };
  }

  async login(email: string, password: string, deviceInfo?: any, ip?: string) {
    const user = await this.userModel.findOne({ email }).select('+password');
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Block login for accounts that haven't passed admin or email gates.
    // - status='inactive' is set on seller self-registration pending admin approval.
    // - status='suspended' is an explicit admin action.
    // - emailVerified=false blocks login when the account has an email; phone-only
    //   accounts bypass this check (they verify via OTP).
    if (user.status === 'suspended') {
      throw new UnauthorizedException('Your account has been suspended. Contact support.');
    }
    if (user.status === 'inactive') {
      throw new UnauthorizedException(
        'Your account is pending approval. You will be notified once it has been reviewed.',
      );
    }
    if (user.email && !user.emailVerified) {
      throw new UnauthorizedException(
        'Please verify your email address before signing in. Check your inbox for the verification link.',
      );
    }

    const payload = { id: user._id.toString() };
    const token = this.jwtService.sign(payload);
    const expiresIn = process.env.JWT_EXPIRE || '30d';
    const expiresAt = this.calculateExpiry(expiresIn);

    // Create session
    await this.createSession(user._id, token, deviceInfo, ip, expiresAt);

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    return {
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    };
  }

  async sendLoginOtp(phone: string) {
    if (!phone) {
      throw new BadRequestException('Phone number is required');
    }

    const normalizedPhone = phone.trim();

    let user = await this.userModel.findOne({ phone: normalizedPhone });

    if (!user) {
      // Auto-register lightweight customer for new-age flow
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(randomPassword, salt);

      // Modern e-commerce: Don't set name initially - use progressive profiling
      // User will be prompted to add name later in their profile
      user = await this.userModel.create({
        name: undefined, // Empty name - user will add it later
        email: undefined,
        password: hashedPassword,
        phone: normalizedPhone,
        role: 'customer',
        status: 'active',
        emailVerified: false,
        phoneVerified: false,
      });
    }

    const otp = (Math.floor(100000 + Math.random() * 900000)).toString();
    user.phoneLoginOtp = otp;
    user.phoneLoginOtpExpire = new Date(Date.now() + 10 * 60 * 1000);
    // Issuing a fresh OTP resets attempt counter and any prior lockout. The
    // legitimate user may have triggered lockout themselves by mistyping; a
    // resend should give them a clean slate.
    user.phoneLoginOtpAttempts = 0;
    user.phoneLoginOtpLockedUntil = undefined;
    await user.save();

    // Try to send SMS, but don't fail if SMS service is not configured
    let smsDelivered = true;
    try {
      await this.smsService.sendOTP(normalizedPhone, otp);
    } catch (error: any) {
      smsDelivered = false;
      this.logger.error(`SMS OTP send failed for ${normalizedPhone}: ${error?.message || error}`);
    }

    // Only ever expose the raw OTP outside production *and* only when SMS is unavailable
    // (so the dev workflow still works without Twilio). Never in production.
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    const exposeOtp = !isProd && !smsDelivered;

    if (exposeOtp) {
      this.logger.warn(`SMS unavailable in non-prod — exposing OTP in response for ${normalizedPhone}`);
    }

    return {
      success: true,
      message: 'OTP sent successfully',
      ...(exposeOtp ? { otp } : {}),
      expiresIn: 600,
    };
  }

  async loginWithPhone(phone: string, otp: string, deviceInfo?: any, ip?: string) {
    if (!phone || !otp) {
      throw new BadRequestException('Phone and OTP are required');
    }

    const normalizedPhone = phone.trim();

    // Look up the account by phone *only*, so wrong-OTP attempts can be counted
    // per account. Previously the query filtered by OTP value, which made
    // miss-counted attempts invisible — an attacker rotating through OTPs from
    // many IPs could brute-force a 6-digit code without ever hitting a counter.
    const candidate = await this.userModel.findOne({ phone: normalizedPhone });
    if (!candidate) {
      // Don't reveal whether the phone exists.
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // Per-account lockout: if locked, refuse all OTP attempts until the lock
    // expires. The lock window is set below when attempts cross the threshold.
    const now = new Date();
    if (candidate.phoneLoginOtpLockedUntil && candidate.phoneLoginOtpLockedUntil > now) {
      throw new UnauthorizedException(
        'Too many failed OTP attempts. Please request a new code in a few minutes.',
      );
    }

    const otpMatches =
      candidate.phoneLoginOtp === otp &&
      !!candidate.phoneLoginOtpExpire &&
      candidate.phoneLoginOtpExpire > now;

    if (!otpMatches) {
      // Increment attempts atomically so concurrent requests can't race past
      // the limit. After 5 failures, lock the account for 15 minutes.
      const MAX_ATTEMPTS = 5;
      const LOCK_MINUTES = 15;
      const updated = await this.userModel.findOneAndUpdate(
        { _id: candidate._id },
        { $inc: { phoneLoginOtpAttempts: 1 } },
        { new: true },
      );
      if (updated && (updated.phoneLoginOtpAttempts || 0) >= MAX_ATTEMPTS) {
        await this.userModel.updateOne(
          { _id: candidate._id },
          {
            phoneLoginOtpLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000),
            // Burn the OTP so even if the attacker guesses the right value
            // during the lock window, it's already invalid.
            phoneLoginOtp: undefined,
            phoneLoginOtpExpire: undefined,
          },
        );
      }
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    // Successful login — clear the OTP, the attempt counter, and any lock.
    const user = candidate;
    user.phoneLoginOtp = undefined;
    user.phoneLoginOtpExpire = undefined;
    user.phoneLoginOtpAttempts = 0;
    user.phoneLoginOtpLockedUntil = undefined;
    user.phoneVerified = true;
    user.lastLogin = new Date();
    await user.save();

    const payload = { id: user._id.toString() };
    const token = this.jwtService.sign(payload);
    const expiresIn = process.env.JWT_EXPIRE || '30d';
    const expiresAt = this.calculateExpiry(expiresIn);

    // Create session
    await this.createSession(user._id, token, deviceInfo, ip, expiresAt);

    return {
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
      },
    };
  }

  async socialLogin(provider: string, code: string) {
    let userData: any;
    let accessToken: string;

    if (provider === 'google') {
      // Exchange code for access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirect_uri: `${process.env.FRONTEND_URL}/auth/google/callback`,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
      if (!tokenData.access_token) {
        throw new BadRequestException('Failed to get access token from Google');
      }

      accessToken = tokenData.access_token;

      // Get user info from Google
      const userInfoResponse = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      userData = await userInfoResponse.json();
    } else if (provider === 'facebook') {
      // Exchange code for access token
      const tokenResponse = await fetch(
        `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${process.env.FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_APP_SECRET}&redirect_uri=${encodeURIComponent(`${process.env.FRONTEND_URL}/auth/facebook/callback`)}&code=${code}`,
        {
          method: 'GET',
        }
      );

      const tokenData = (await tokenResponse.json()) as { access_token?: string; error?: string };
      if (!tokenData.access_token) {
        throw new BadRequestException('Failed to get access token from Facebook');
      }

      accessToken = tokenData.access_token;

      // Get user info from Facebook
      const userInfoResponse = await fetch(
        `https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`
      );
      userData = await userInfoResponse.json();
    } else {
      throw new BadRequestException('Invalid provider');
    }

    if (!userData.email) {
      throw new BadRequestException('Email not provided by social provider');
    }

    // Find or create user
    let user = await this.userModel.findOne({ email: userData.email });

    if (!user) {
      user = await this.userModel.create({
        name: userData.name,
        email: userData.email,
        password: crypto.randomBytes(32).toString('hex'), // Random password for social login users
        emailVerified: true,
        socialLogin: {
          provider,
          providerId: userData.id,
        },
      });
    } else {
      // Update social login info
      user.socialLogin = {
        provider,
        providerId: userData.id,
      };
      user.emailVerified = true;
      await user.save();
    }

    const payload = { id: user._id.toString() };
    const token = this.jwtService.sign(payload);

    return {
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    };
  }

  async verifyEmail(token: string) {
    const user = await this.userModel.findOne({
      emailVerificationToken: token,
      emailVerificationExpire: { $gt: Date.now() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpire = undefined;
    await user.save();

    return {
      success: true,
      message: 'Email verified successfully',
    };
  }

  async forgotPassword(email: string) {
    const user = await this.userModel.findOne({ email });
    if (!user) {
      // Don't reveal whether the email is registered.
      return {
        success: true,
        message: 'If email exists, password reset link has been sent',
      };
    }

    // Email gets the raw token (so the user can click the link); the database
    // stores only its SHA-256 hash. A DB read leak therefore can't be used to
    // hijack accounts — the attacker would still need to brute-force the
    // 256-bit token from its hash. This mirrors the standard pattern used by
    // password-reset implementations in mature frameworks.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpire = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    try {
      await this.emailService.sendPasswordResetEmail(email, rawToken);
    } catch (error) {
      throw new BadRequestException('Error sending email');
    }

    return {
      success: true,
      message: 'If email exists, password reset link has been sent',
    };
  }

  async resetPassword(token: string, password: string) {
    // The link contains the raw token; we hash it and look up by the hash.
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await this.userModel.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    // Revoke all existing sessions so an attacker who already had access loses
    // it on password reset. The user will need to log in again on every device.
    try {
      await this.sessionModel.updateMany(
        { user: user._id, isActive: true },
        { isActive: false },
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to revoke sessions for user ${user._id} after password reset: ${err?.message || err}`,
      );
    }

    return {
      success: true,
      message: 'Password reset successfully',
    };
  }

  async validateUser(userId: string) {
    const user = await this.userModel.findById(userId).select('-password');
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('User not found or inactive');
    }
    return user;
  }

  /**
   * Create a new session
   */
  private async createSession(
    userId: mongoose.Types.ObjectId,
    token: string,
    deviceInfo?: any,
    ip?: string,
    expiresAt?: Date,
  ) {
    const expiresIn = process.env.JWT_EXPIRE || '30d';
    const sessionExpiresAt = expiresAt || this.calculateExpiry(expiresIn);

    // Parse device info if provided
    let parsedDeviceInfo = null;
    if (deviceInfo?.userAgent) {
      parsedDeviceInfo = parseDeviceInfo(deviceInfo.userAgent, ip);
    }

    await this.sessionModel.create({
      userId,
      token: this.hashToken(token), // Store hashed token for security
      deviceInfo: parsedDeviceInfo,
      location: ip ? { ip } : undefined,
      expiresAt: sessionExpiresAt,
      lastActivity: new Date(),
      isActive: true,
    });
  }

  /**
   * Calculate token expiry date
   */
  private calculateExpiry(expiresIn: string): Date {
    const now = new Date();
    const match = expiresIn.match(/^(\d+)([dhms])$/);
    if (!match) {
      // Default to 30 days
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'd':
        return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
      case 'h':
        return new Date(now.getTime() + value * 60 * 60 * 1000);
      case 'm':
        return new Date(now.getTime() + value * 60 * 1000);
      case 's':
        return new Date(now.getTime() + value * 1000);
      default:
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Hash token for storage (simple hash, not for security, just for reference)
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string) {
    const sessions = await this.sessionModel
      .find({
        userId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      })
      .sort({ lastActivity: -1 })
      .lean();

    return sessions.map((session) => ({
      id: session._id.toString(),
      deviceInfo: session.deviceInfo,
      location: session.location,
      lastActivity: session.lastActivity,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: false, // Will be set by controller if token matches
    }));
  }

  /**
   * Get all sessions with tokens for comparison (internal use)
   */
  async getUserSessionsWithTokens(userId: string) {
    const sessions = await this.sessionModel
      .find({
        userId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      })
      .sort({ lastActivity: -1 })
      .lean();

    return sessions.map((session) => ({
      id: session._id.toString(),
      token: session.token,
      deviceInfo: session.deviceInfo,
      location: session.location,
      lastActivity: session.lastActivity,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    }));
  }

  /**
   * Revoke a session
   */
  async revokeSession(userId: string, sessionId: string) {
    const session = await this.sessionModel.findOne({
      _id: sessionId,
      userId,
      isActive: true,
    });

    if (!session) {
      throw new BadRequestException('Session not found or already revoked');
    }

    session.isActive = false;
    session.revokedAt = new Date();
    await session.save();

    return { success: true, message: 'Session revoked successfully' };
  }

  /**
   * Revoke all sessions except current
   */
  async revokeAllOtherSessions(userId: string, currentToken: string) {
    const hashedCurrentToken = this.hashToken(currentToken);
    
    await this.sessionModel.updateMany(
      {
        userId,
        token: { $ne: hashedCurrentToken },
        isActive: true,
      },
      {
        isActive: false,
        revokedAt: new Date(),
      }
    );

    return { success: true, message: 'All other sessions revoked successfully' };
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(token: string) {
    const hashedToken = this.hashToken(token);
    await this.sessionModel.updateOne(
      { token: hashedToken, isActive: true },
      { lastActivity: new Date() }
    );
  }
}

