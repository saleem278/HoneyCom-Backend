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
    // Don't throw error if no token or invalid token - just return null
    // This allows the endpoint to work for both authenticated and unauthenticated users
    if (err || !user) {
      return null; // Return null instead of throwing
    }
    return user;
  }
}

