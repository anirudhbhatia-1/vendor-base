import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IdentityAccessService } from '@neighbourhood-store/database';
import type { UuidV7 } from '@neighbourhood-store/domain-types';
import type { AuthorizationRequirement } from './authorization.js';
import { ACCESS_IDENTITY } from './tokens.js';

export interface AuthorizationEvidence {
  readonly admin_scope?: {
    readonly kind: 'GLOBAL' | 'VENDOR_LOCATION' | 'ZONE';
    readonly scope_id?: UuidV7;
  };
  readonly delivery_assignment_id?: UuidV7;
  readonly owner_user_id?: UuidV7;
  readonly vendor_location_id?: UuidV7;
}

@Injectable()
export class AuthorizationEnforcementService {
  constructor(@Inject(ACCESS_IDENTITY) private readonly access: IdentityAccessService) {}

  async enforce(input: {
    readonly evidence: AuthorizationEvidence;
    readonly requirement: AuthorizationRequirement;
    readonly user_id: UuidV7;
  }) {
    if (input.evidence.owner_user_id && input.evidence.owner_user_id !== input.user_id) {
      this.deny(input.requirement);
    }
    const decision = await this.access.evaluate({
      capability: input.requirement.capability,
      user_id: input.user_id,
      ...(input.evidence.vendor_location_id
        ? { vendor_location_id: input.evidence.vendor_location_id }
        : {}),
      ...(input.evidence.delivery_assignment_id
        ? { delivery_assignment_id: input.evidence.delivery_assignment_id }
        : {}),
      ...(input.evidence.admin_scope ? { admin_scope: input.evidence.admin_scope } : {}),
    });
    if (!decision.allowed) this.deny(input.requirement);
    return decision;
  }

  private deny(requirement: AuthorizationRequirement): never {
    if (requirement.conceal_resource) throw new NotFoundException();
    throw new ForbiddenException();
  }
}
