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
    // If NO token was provided → guest access (allow through).
    // If token is EXPIRED → also treat as guest; the client will clear it on
    //   the next 401 from a protected endpoint. Blocking expired tokens here
    //   causes 401s on public endpoints (banners, products) during token rollover.
    // If token is FORGED / malformed (JsonWebTokenError) → reject.
    if (err) throw err;
    if (!user) {
      const infoName: string = info?.name ?? '';
      const isExpired = infoName === 'TokenExpiredError';
      const isNoToken = !infoName || infoName === 'No auth token';
      if (isExpired || isNoToken) {
        return null; // Guest access
      }
      const { UnauthorizedException } = require('@nestjs/common');
      throw new UnauthorizedException(info.message || 'Invalid token');
    }
    return user;
  }
}

