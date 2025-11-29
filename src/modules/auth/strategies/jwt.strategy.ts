import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request } from 'express';
import * as crypto from 'crypto';
import { User, IUser } from '../../../models/User.model';
import { Session, ISession } from '../../../models/Session.model';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectModel('User') private userModel: Model<IUser>,
    @InjectModel('Session') private sessionModel: Model<ISession>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'your-secret-key',
      passReqToCallback: true, // Allow access to request object
    });
  }

  async validate(req: Request, payload: any) {
    // Get the token from the request
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    
    if (!token) {
      throw new UnauthorizedException('Token not found');
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
    };
  }
}

