import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    // Check if Authorization header exists
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    
    // If no token, allow the request to proceed without authentication
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return true;
    }
    
    // If token exists, try to authenticate
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    // If NO token was provided, treat as unauthenticated guest (allow through).
    // If a token WAS provided but is invalid/expired, reject — a client that
    // deliberately sends a token expects authentication, and a forged/stale
    // token should never silently downgrade to guest access.
    if (err) throw err;
    if (!user) {
      // info.name === 'JsonWebTokenError' | 'TokenExpiredError' when a token
      // was supplied but failed verification. Distinguish from "no token" case.
      if (info && info.name && info.name !== 'No auth token') {
        const { UnauthorizedException } = require('@nestjs/common');
        throw new UnauthorizedException(info.message || 'Invalid token');
      }
      return null; // Genuinely no token → guest
    }
    return user;
  }
}

