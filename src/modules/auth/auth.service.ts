import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
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

    // Send verification email
    try {
      await this.emailService.sendVerificationEmail(email, verificationToken);
      console.log(`Verification email sent to ${email}`);
    } catch (error: any) {
      // Log error for debugging
      console.error('Failed to send verification email:', error.message || error);
      // Don't fail registration if email fails, but log the error
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

    // Send verification email
    try {
      await this.emailService.sendVerificationEmail(email, verificationToken);
      console.log(`✅ Verification email sent to ${email}`);
    } catch (error: any) {
      // Log error for debugging
      console.error('❌ Failed to send verification email:', error.message || error);
      // Don't fail registration if email fails, but log the error
    }

    // Notify admin about new seller registration
    try {
      const adminUsers = await this.userModel.find({ role: 'admin' }).select('email name');
      const adminEmails = adminUsers.map(admin => admin.email).filter(Boolean);
      
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
          }).catch(err => {
            // Log error but don't fail registration
            console.error(`Failed to send notification to ${adminEmail}:`, err);
          })
        ));
      }
    } catch (error) {
      // Don't fail registration if notification fails
      console.error('Error sending admin notification:', error);
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
    // Check if user exists
    const user = await this.userModel.findOne({ email }).select('+password');
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if password matches
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate token
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
    await user.save();

    try {
      await this.smsService.sendOTP(normalizedPhone, otp);
    } catch (error: any) {
      throw new BadRequestException(
        error?.message || 'Failed to send OTP. Please try again.'
      );
    }

    return {
      success: true,
      message: 'OTP sent successfully',
    };
  }

  async loginWithPhone(phone: string, otp: string, deviceInfo?: any, ip?: string) {
    if (!phone || !otp) {
      throw new BadRequestException('Phone and OTP are required');
    }

    const normalizedPhone = phone.trim();

    const user = await this.userModel.findOne({
      phone: normalizedPhone,
      phoneLoginOtp: otp,
      phoneLoginOtpExpire: { $gt: new Date() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    user.phoneLoginOtp = undefined;
    user.phoneLoginOtpExpire = undefined;
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
      // Don't reveal if user exists
      return {
        success: true,
        message: 'If email exists, password reset link has been sent',
      };
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpire = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // Send reset email
    try {
      await this.emailService.sendPasswordResetEmail(email, resetToken);
    } catch (error) {
      // Error sending reset email
      throw new BadRequestException('Error sending email');
    }

    return {
      success: true,
      message: 'If email exists, password reset link has been sent',
    };
  }

  async resetPassword(token: string, password: string) {
    const user = await this.userModel.findOne({
      resetPasswordToken: token,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

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

