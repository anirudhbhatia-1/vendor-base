import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  IdentityAccessService,
  IdentityPreferencesService,
  IdentitySessionService,
  OtpIdentityService,
  VendorOnboardingService,
  VendorPublicationService,
} from '@neighbourhood-store/database';
import {
  ACCESS_IDENTITY,
  IDENTITY_PREFERENCES,
  OTP_IDENTITY,
  SESSION_IDENTITY,
  VENDOR_ONBOARDING,
  VENDOR_PUBLICATION,
} from './tokens.js';

@Injectable()
export class OtpLifecycleService implements OnApplicationShutdown {
  constructor(
    @Inject(OTP_IDENTITY) private readonly identity: OtpIdentityService,
    @Inject(SESSION_IDENTITY) private readonly sessions: IdentitySessionService,
    @Inject(ACCESS_IDENTITY) private readonly access: IdentityAccessService,
    @Inject(IDENTITY_PREFERENCES) private readonly preferences: IdentityPreferencesService,
    @Inject(VENDOR_ONBOARDING) private readonly onboarding: VendorOnboardingService,
    @Inject(VENDOR_PUBLICATION) private readonly publication: VendorPublicationService,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.publication.close();
    await this.onboarding.close();
    await this.preferences.close();
    await this.access.close();
    await this.sessions.close();
    await this.identity.close();
  }
}
