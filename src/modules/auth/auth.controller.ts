import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  UseGuards,
  Request,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Verify2FADto, Disable2FADto, Login2FADto } from './dto/two-factor.dto';
import { SocialLoginDto } from './dto/social-login.dto';
import { RequestPhoneOtpDto, VerifyPhoneOtpDto } from './dto/phone-login.dto';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { AuthedRequest } from '../../common/types/request.types';
import { SESSION_COOKIE_NAME } from './strategies/jwt.strategy';

/**
 * Set the session cookie on the outgoing response. HttpOnly so JS can't
 * read it (defence vs XSS-token-exfil), Secure in production so it only
 * travels over HTTPS, SameSite=Lax so it follows top-level navigation
 * but not cross-site form posts. maxAge mirrors JWT_EXPIRE.
 *
 * Returns the same payload it was given so callers can write
 * `return setSessionCookie(res, payload)` for terseness.
 */
function setSessionCookie<T extends { token?: string }>(res: ExpressResponse, payload: T): T {
  if (payload?.token) {
    const isProd = process.env.NODE_ENV === 'production';
    const expireRaw = process.env.JWT_EXPIRE || '30d';
    // Convert "30d", "12h", "60m" into milliseconds. Anything else
    // (including raw seconds) falls back to 30 days so the cookie
    // doesn't end up persistently invalid.
    const match = /^(\d+)\s*([dhms])$/.exec(expireRaw.trim());
    let maxAgeMs = 30 * 24 * 60 * 60 * 1000;
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2];
      maxAgeMs =
        unit === 'd' ? n * 86_400_000 :
        unit === 'h' ? n * 3_600_000 :
        unit === 'm' ? n * 60_000 :
        n * 1000;
    }
    res.cookie(SESSION_COOKIE_NAME, payload.token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: maxAgeMs,
      path: '/',
    });
  }
  return payload;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 400, description: 'User already exists or validation error' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('register/seller')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Register as a seller with business information' })
  @ApiResponse({ status: 201, description: 'Seller registration submitted for approval' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async registerSeller(@Body() sellerData: any) {
    return this.authService.registerSeller(sellerData);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Login user' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.socket?.remoteAddress || '';
    const deviceInfo = { userAgent };
    const result = await this.authService.login(loginDto.email, loginDto.password, deviceInfo, ip);
    return setSessionCookie(res, result as any);
  }

  @Post('login/phone/request-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Request OTP for phone login' })
  @ApiBody({ type: RequestPhoneOtpDto })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 400, description: 'Validation error or phone not found' })
  async requestPhoneOtp(@Body() body: RequestPhoneOtpDto) {
    return this.authService.sendLoginOtp(body.phone);
  }

  @Post('login/phone/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Verify OTP and login with phone' })
  @ApiBody({ type: VerifyPhoneOtpDto })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP' })
  async verifyPhoneOtp(
    @Body() body: VerifyPhoneOtpDto,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.socket?.remoteAddress || '';
    const deviceInfo = { userAgent };
    const result = await this.authService.loginWithPhone(body.phone, body.otp, deviceInfo, ip);
    return setSessionCookie(res, result as any);
  }

  @Post('social-login')
  @ApiOperation({ summary: 'Social login (Google/Facebook)' })
  @ApiBody({ type: SocialLoginDto })
  @ApiResponse({ status: 200, description: 'Social login successful' })
  @ApiResponse({ status: 400, description: 'Invalid provider or code' })
  async socialLogin(
    @Body() socialLoginDto: SocialLoginDto,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const result = await this.authService.socialLogin(socialLoginDto.provider, socialLoginDto.code);
    return setSessionCookie(res, result as any);
  }

  @Get('verify-email')
  @ApiOperation({ summary: 'Verify email address' })
  @ApiQuery({ name: 'token', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request password reset' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset email sent' })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto.email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(
      resetPasswordDto.token,
      resetPasswordDto.password
    );
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Change password (authenticated)' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  async changePassword(@Request() req: AuthedRequest, @Body() dto: ChangePasswordDto) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    return this.authService.changePassword(req.user.id, dto.currentPassword, dto.newPassword, token);
  }

  // -------- TOTP 2FA --------

  @Post('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Begin 2FA enrolment — returns secret + otpauth URL for QR' })
  @ApiResponse({ status: 200, description: 'Pending secret generated' })
  async setup2FA(@Request() req: AuthedRequest) {
    return this.authService.setup2FA(req.user.id);
  }

  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Confirm 2FA enrolment with a TOTP code; returns recovery codes' })
  @ApiBody({ type: Verify2FADto })
  @ApiResponse({ status: 200, description: '2FA enabled, recovery codes returned (once)' })
  @ApiResponse({ status: 401, description: 'Invalid 2FA code' })
  async verify2FA(@Request() req: AuthedRequest, @Body() dto: Verify2FADto) {
    return this.authService.verifyAndEnable2FA(req.user.id, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Disable 2FA (requires current password)' })
  @ApiBody({ type: Disable2FADto })
  @ApiResponse({ status: 200, description: '2FA disabled' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  async disable2FA(@Request() req: AuthedRequest, @Body() dto: Disable2FADto) {
    return this.authService.disable2FA(req.user.id, dto.currentPassword);
  }

  @Post('2fa/login-verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Exchange 2FA challenge + code for a real session token' })
  @ApiBody({ type: Login2FADto })
  @ApiResponse({ status: 200, description: 'Login complete, token issued' })
  @ApiResponse({ status: 401, description: 'Invalid challenge or code' })
  async login2FA(
    @Body() dto: Login2FADto,
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.socket?.remoteAddress || '';
    const result = await this.authService.loginVerify2FA(dto.twoFactorChallenge, dto.code, { userAgent }, ip);
    return setSessionCookie(res, result as any);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current user' })
  @ApiResponse({ status: 200, description: 'Current user information' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@Request() req: AuthedRequest) {
    const user = await this.authService.validateUser(req.user.id);
    // Update session activity
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (token) {
      await this.authService.updateSessionActivity(token);
    }
    return {
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(
    @Request() req: AuthedRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (token) {
      await this.authService.updateSessionActivity(token);
    }
    // Clear the session cookie. clearCookie must mirror the path the
    // cookie was set on or the browser will keep the original around.
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return {
      success: true,
      message: 'Logged out successfully',
    };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all active sessions for current user' })
  @ApiResponse({ status: 200, description: 'Sessions retrieved successfully' })
  async getSessions(@Request() req: AuthedRequest) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const sessions = await this.authService.getUserSessions(req.user.id);

    // Mark current session by comparing hashed tokens
    const hashedCurrentToken = this.authService.hashToken(token);
    // We need to get sessions with tokens to compare
    const sessionsWithTokens = await this.authService.getUserSessionsWithTokens(req.user.id);
    const sessionsWithCurrent = sessions.map((session: any) => {
      const matchingSession = sessionsWithTokens.find((s: any) => s.id === session.id);
      const isCurrent = matchingSession?.token === hashedCurrentToken;
      return {
        ...session,
        isCurrent,
      };
    });

    return {
      success: true,
      sessions: sessionsWithCurrent,
    };
  }

  @Post('sessions/:sessionId/revoke')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiResponse({ status: 200, description: 'Session revoked successfully' })
  @ApiResponse({ status: 400, description: 'Session not found' })
  async revokeSession(@Request() req: AuthedRequest, @Param('sessionId') sessionId: string) {
    return this.authService.revokeSession(req.user.id, sessionId);
  }

  @Post('sessions/revoke-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Revoke all sessions except current' })
  @ApiResponse({ status: 200, description: 'All other sessions revoked successfully' })
  async revokeAllSessions(@Request() req: AuthedRequest) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    return this.authService.revokeAllOtherSessions(req.user.id, token);
  }
}

