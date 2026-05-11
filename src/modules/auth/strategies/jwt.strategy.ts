import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, JwtFromRequestFunction } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import * as crypto from 'crypto';
import { User, IUser } from '../../../models/User.model';
import { Session, ISession } from '../../../models/Session.model';

export const SESSION_COOKIE_NAME = 'honeycom_session';
/**
 * During an admin impersonation session, the admin's original token is
 * stashed under this name so it can be restored when the admin ends
 * impersonation. The frontend never reads this cookie (it's HttpOnly);
 * the backend just swaps the two cookies in start/end endpoints.
 */
export const ADMIN_STASH_COOKIE_NAME = 'honeycom_admin_session';

/**
 * Reads the JWT from the session cookie. Returns null when missing so
 * passport-jwt's chained extractor falls through to the next one.
 */
const cookieExtractor: JwtFromRequestFunction = (req: Request) => {
  if (!req?.cookies) return null;
  const value = req.cookies[SESSION_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Session') private sessionModel: Model<ISession>,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error(
        'JWT_SECRET must be set and at least 32 characters. Refusing to boot with a weak or default secret.',
      );
    }
    super({
      // Cookie path first, Authorization header second. During the
      // migration both work simultaneously; once the cookie path is
      // observed working in prod for a release cycle the header path
      // can be retired (along with the JSON `token` field on responses).
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    // Read the token using the same extractor chain as jwtFromRequest
    // so `validate` can hash it for the session lookup. We can't reuse
    // the chain object literal because passport-jwt invoked it before
    // calling validate — easier to re-derive.
    const token =
      cookieExtractor(req) || ExtractJwt.fromAuthHeaderAsBearerToken()(req);

    if (!token) {
      throw new UnauthorizedException('Token not found');
    }

    // Reject any token that isn't a session-grade purpose. Only
    // `session` (normal logins, including social + phone) and
    // `impersonation` (admin acting as another user) authenticate API
    // requests. `2fa-challenge` tokens are minted by /auth/login when
    // 2FA is active — they identify the user but must be exchanged at
    // /auth/2fa/login-verify before granting access. Any other claim
    // (or a token without `purpose` minted after this rollout) is
    // refused.
    //
    // During rollover we accept tokens with NO purpose claim so
    // legacy in-flight sessions don't all 401 at once. Remove the
    // `purpose === undefined` branch after the JWT_EXPIRE window
    // (default 30 days) elapses.
    if (
      payload.purpose !== undefined &&
      payload.purpose !== 'session' &&
      payload.purpose !== 'impersonation'
    ) {
      throw new UnauthorizedException('Token cannot authenticate API requests');
    }

    // Hash the token to check against stored sessions
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Check if session exists and is active
    const session = await this.sessionModel.findOne({
      token: hashedToken,
      isActive: true,
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      throw new UnauthorizedException('Session has been revoked or expired');
    }

    // Validate user
    const user = await this.userModel.findById(payload.id).select('-password');
    
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is inactive');
    }

    // Update session activity
    session.lastActivity = new Date();
    await session.save();

    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      // Pass-through the impersonator id when present in the JWT.
      // Downstream code (audit trail, banner rendering) uses it to
      // distinguish "admin acting as themselves" from "admin acting
      // through a target user". Plain logins set this to undefined,
      // so the field is harmless when absent.
      impersonator: payload.impersonator,
    };
  }
}

