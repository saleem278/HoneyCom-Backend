import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User, IUser } from '../../models/User.model';
import { EmailService } from '../../services/email.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel('User') private userModel: Model<IUser>,
    private jwtService: JwtService,
    private emailService: EmailService,
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

  async login(email: string, password: string) {
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
}

