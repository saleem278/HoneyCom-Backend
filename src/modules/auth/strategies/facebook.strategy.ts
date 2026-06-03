import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-facebook';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FacebookStrategy extends PassportStrategy(Strategy, 'facebook') {
  constructor(private configService: ConfigService) {
    // Use empty-string fallbacks so the strategy can be constructed even when
    // social-login isn't configured. The actual sign-in flow will fail clearly
    // at runtime if Facebook calls a strategy that has no credentials.
    super({
      clientID: configService.get<string>('FACEBOOK_APP_ID') || '',
      clientSecret: configService.get<string>('FACEBOOK_APP_SECRET') || '',
      callbackURL: `${configService.get<string>('FRONTEND_URL') || ''}/auth/facebook/callback`,
      scope: 'email',
      profileFields: ['emails', 'name'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (err: any, user: any, info?: any) => void,
  ): Promise<any> {
    const { name, emails, id } = profile;
    const email = emails?.[0]?.value;
    const givenName = name?.givenName ?? '';
    const familyName = name?.familyName ?? '';
    if (!email) {
      return done(new Error('Facebook profile did not include an email'), null);
    }
    const user = {
      email,
      name: `${givenName} ${familyName}`.trim(),
      providerId: id,
      accessToken,
    };
    done(null, user);
  }
}

