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
import { RegisterSellerDto } from './dto/register-seller.dto';
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
import {
  sessionCookieOptions,
  clearSessionCookieOptions,
  parseExpiryToMs,
} from '../../common/utils/cookie-options';

/**
 * Set the session cookie on the outgoing response. HttpOnly so JS can't
 * read it (defence vs XSS token exfiltration). SameSite/Secure config
 * lives in `cookie-options.ts` so every cookie call site stays in
 * lock-step — drift is what produced the cross-site 401 loop after
 * the cookie-only migration shipped (frontend on Vercel, backend on
 * Render → cross-site → SameSite=Lax silently drops the cookie on
 * XHR, so /admin/dashboard saw no auth right after login succeeded).
 *
 * Returns the same payload it was given so callers can write
 * `return setSessionCookie(res, payload)` for terseness.
 */
function setSessionCookie<T extends { token?: string }>(res: ExpressResponse, payload: T): T {
  if (payload?.token) {
    const maxAgeMs = parseExpiryToMs(process.env.JWT_EXPIRE);
    res.cookie(SESSION_COOKIE_NAME, payload.token, sessionCookieOptions(maxAgeMs));
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
  @ApiBody({ type: RegisterSellerDto })
  @ApiResponse({ status: 201, description: 'Seller registration submitted for approval' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async registerSeller(@Body() sellerData: RegisterSellerDto) {
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
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || req.socket?.remoteAddress || '';
    const result = await this.authService.socialLogin(
      socialLoginDto.provider,
      socialLoginDto.code,
      { userAgent },
      ip,
    );
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
  @Throttle({ default: { limit: 3, ttl: 60000 } })
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
    // Revoke the session so this token cannot be replayed even if it
    // hasn't expired. Without this, a stolen token stays valid for up
    // to JWT_EXPIRE (default 30 days) after the user logs out.
    const token =
      req.cookies?.[SESSION_COOKIE_NAME] ||
      (req.headers.authorization || '').replace('Bearer ', '');
    if (token) {
      try {
        await this.authService.revokeSessionByToken(token);
      } catch (err: any) {
        // Best-effort: don't fail logout if revocation hits a DB hiccup.
        // The cookie is cleared below regardless.
      }
    }
    res.clearCookie(SESSION_COOKIE_NAME, clearSessionCookieOptions());
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

