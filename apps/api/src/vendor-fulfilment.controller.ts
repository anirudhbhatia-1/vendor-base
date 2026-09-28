import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  AssignmentCustodyService,
  SupportCaseService,
  VendorFulfilmentService,
} from '@neighbourhood-store/database';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { ASSIGNMENT_CUSTODY, SUPPORT_CASES, VENDOR_FULFILMENT } from './tokens.js';
import {
  integerField,
  object,
  optionalString,
  optionalStrings,
  stringField,
  uuid,
} from './request-fields.js';
import { translateDomainError } from './domain-errors.js';
const vendorFulfil = RequireAuthorization({
  capability: 'vendor.order.fulfil',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});
const customerDecide = RequireAuthorization({
  capability: 'customer.order.decide',
  conceal_resource: true,
});
const customerRead = RequireAuthorization({
  capability: 'customer.order.read',
  conceal_resource: true,
});
const customerRate = RequireAuthorization({
  capability: 'customer.order.rate',
  conceal_resource: true,
});
const customerSupport = RequireAuthorization({
  capability: 'customer.support.open',
  conceal_resource: true,
});
const partnerActs = RequireAuthorization({
  capability: 'partner.assignment.act',
  conceal_resource: true,
  delivery_assignment_id_param: 'delivery_assignment_id',
});

/**
 * The partner's side of a vendor handover (DLP-24).
 *
 * Lives with the fulfilment routes rather than the assignment routes because
 * the code it mints is the vendor order's pickup code -- the same column, the
 * same lifetime, the same validation in `complete-pickup` -- and not a property
 * of the assignment.
 */
@Controller('partner/assignments')
export class PartnerHandoverController {
  constructor(@Inject(VENDOR_FULFILMENT) private readonly fulfilment: VendorFulfilmentService) {}

  /**
   * A POST for the same reasons as the customer's codes: it mints a fresh
   * value, which is a state change, and it keeps the code out of the URL.
   */
  @Post(':delivery_assignment_id/pickup-otp')
  @partnerActs
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async pickupOtp(@Param('delivery_assignment_id') assignmentId: string) {
    try {
      return await this.fulfilment.issuePartnerPickupOtp({
        context: currentRequestContext(),
        delivery_assignment_id: uuid(assignmentId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

/**
 * A store's own numbers and the cases open against it (VEN-43, VEN-45, VEN-47).
 *
 * Read-only, scoped to the location the caller staffs.
 */
@Controller('vendor/locations/:vendor_location_id/insights')
export class VendorInsightsController {
  constructor(@Inject(VENDOR_FULFILMENT) private readonly fulfilment: VendorFulfilmentService) {}

  @Get()
  @vendorFulfil
  async summary(@Param('vendor_location_id') locationId: string) {
    try {
      return await this.fulfilment.locationInsights({
        context: currentRequestContext(),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('support-cases')
  @vendorFulfil
  async supportCases(@Param('vendor_location_id') locationId: string) {
    try {
      return {
        cases: await this.fulfilment.locationSupportCases({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }
}

@Controller('vendor/locations/:vendor_location_id/orders')
export class VendorOrderFulfilmentController {
  constructor(
    @Inject(VENDOR_FULFILMENT) private readonly fulfilment: VendorFulfilmentService,
    @Inject(ASSIGNMENT_CUSTODY) private readonly assignments: AssignmentCustodyService,
  ) {}

  /**
   * The counter confirms the partner is here (9.4): the approved fallback for
   * an arrival the device's position could not support. Scoped to this
   * store, and the service checks the assignment is this store's own.
   */
  @Post(':vendor_order_id/confirm-partner-arrival')
  @vendorFulfil
  @HttpCode(200)
  async confirmPartnerArrival(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    void orderId;
    try {
      return await this.assignments.confirmPartnerArrival({
        command_reference: stringField(body, 'command_reference'),
        context: currentRequestContext(),
        delivery_assignment_id: uuid(stringField(body, 'delivery_assignment_id')),
        expected_version: integerField(body, 'expected_version', 1),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get()
  @vendorFulfil
  async list(@Param('vendor_location_id') locationId: string) {
    try {
      return {
        orders: await this.fulfilment.listVendorOrders({
          context: currentRequestContext(),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/accept')
  @vendorFulfil
  async accept(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.accept({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        expected_version: integerField(body, 'expected_version'),
        preparation_estimate_seconds: integerField(body, 'preparation_estimate_seconds'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':vendor_order_id/decline-preview')
  @vendorFulfil
  async declinePreview(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
  ) {
    try {
      return await this.fulfilment.previewDecline({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/decline')
  @vendorFulfil
  async decline(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.decline({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        expected_version: integerField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
        ...(optionalString(body, 'note') !== undefined
          ? { note: optionalString(body, 'note') as string }
          : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/start-picking')
  @vendorFulfil
  async startPicking(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.startPicking({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        expected_version: integerField(body, 'expected_version'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/lines/:vendor_order_line_id/found')
  @vendorFulfil
  async markFound(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Param('vendor_order_line_id') lineId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.markLineFound({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        vendor_order_line_id: uuid(lineId),
        actual_quantity: integerField(body, 'actual_quantity'),
        actual_unit_price_minor: integerField(body, 'actual_unit_price_minor'),
        expected_version: integerField(body, 'expected_version', 0),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/lines/:vendor_order_line_id/missing')
  @vendorFulfil
  async markMissing(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Param('vendor_order_line_id') lineId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.markLineMissing({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        vendor_order_line_id: uuid(lineId),
        expected_version: integerField(body, 'expected_version', 0),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/lines/:vendor_order_line_id/propose-substitution')
  @vendorFulfil
  async proposeSubstitution(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Param('vendor_order_line_id') lineId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.proposeSubstitution({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        vendor_order_line_id: uuid(lineId),
        substitution_variant_id: uuid(stringField(body, 'substitution_variant_id')),
        proposed_quantity: integerField(body, 'proposed_quantity'),
        proposed_unit_price_minor: integerField(body, 'proposed_unit_price_minor'),
        reason_note: stringField(body, 'reason_note'),
        expected_version: integerField(body, 'expected_version', 0),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/lines/:vendor_order_line_id/propose-weight')
  @vendorFulfil
  async proposeWeight(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Param('vendor_order_line_id') lineId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.proposeWeight({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        vendor_order_line_id: uuid(lineId),
        proposed_quantity: integerField(body, 'proposed_quantity'),
        proposed_unit_price_minor: integerField(body, 'proposed_unit_price_minor'),
        reason_note: stringField(body, 'reason_note'),
        expected_version: integerField(body, 'expected_version', 0),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  /** The store is running late (9.5): more time on the estimate, with a reason. */
  @Post(':vendor_order_id/report-delay')
  @vendorFulfil
  @HttpCode(200)
  async reportDelay(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.reportDelay({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        expected_version: integerField(body, 'expected_version'),
        additional_seconds: integerField(body, 'additional_seconds'),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/ready')
  @vendorFulfil
  async markReady(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.markReady({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        expected_version: integerField(body, 'expected_version'),
        package_count: integerField(body, 'package_count'),
        ...(optionalString(body, 'package_condition_note') !== undefined
          ? { package_condition_note: optionalString(body, 'package_condition_note') as string }
          : {}),
        ...(optionalStrings(body, 'handling_flags') !== undefined
          ? { handling_flags: optionalStrings(body, 'handling_flags') as readonly string[] }
          : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/pickup-otp')
  @vendorFulfil
  async issueOtp(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    // The alternative-proof path (VEN-35), so it carries the reason the
    // customer's own code could not be used.
    const value = object(raw);
    try {
      return await this.fulfilment.issuePickupOtp({
        context: currentRequestContext(),
        reason_code: stringField(value, 'reason_code'),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/complete-pickup')
  @vendorFulfil
  async completePickup(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.completePickup({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        otp: stringField(body, 'otp'),
        ...(optionalString(body, 'proof_note') !== undefined
          ? { proof_note: optionalString(body, 'proof_note') as string }
          : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  /**
   * The self-delivery leg (VEN-37): the store's own staff leave with the order,
   * then complete it at the door against the customer's delivery code.
   */
  @Post(':vendor_order_id/self-delivery/start')
  @vendorFulfil
  async startVendorDelivery(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.startVendorDelivery({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        expected_version: integerField(body, 'expected_version'),
        ...(optionalString(body, 'proof_note') !== undefined
          ? { proof_note: optionalString(body, 'proof_note') as string }
          : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/self-delivery/complete')
  @vendorFulfil
  async completeVendorDelivery(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Body() raw: unknown,
  ) {
    const body = object(raw);
    try {
      return await this.fulfilment.completeVendorDelivery({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        otp: stringField(body, 'otp'),
        ...(optionalString(body, 'proof_note') !== undefined
          ? { proof_note: optionalString(body, 'proof_note') as string }
          : {}),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':vendor_order_id/picks')
  @vendorFulfil
  async listPicks(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
  ) {
    try {
      return {
        picks: await this.fulfilment.listPicks({
          context: currentRequestContext(),
          vendor_order_id: uuid(orderId),
          vendor_location_id: uuid(locationId),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }
}

@Controller('customer/decisions')
export class CustomerDecisionsController {
  constructor(@Inject(VENDOR_FULFILMENT) private readonly fulfilment: VendorFulfilmentService) {}

  @Get('pending')
  @customerRead
  async pending() {
    try {
      const decisions = await this.fulfilment.listPendingCustomerDecisions({
        context: currentRequestContext(),
      });
      return { decisions };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':decision_id/answer')
  @customerDecide
  async answer(@Param('decision_id') decisionId: string, @Body() raw: unknown) {
    const body = object(raw);
    const answer = body['answer'];
    if (answer !== 'APPROVED' && answer !== 'REJECTED') throw new BadRequestException();
    try {
      return await this.fulfilment.answerDecision({
        context: currentRequestContext(),
        decision_id: uuid(decisionId),
        answer,
      });
    } catch (error) {
      translateDomainError(error);
    }
  }
}

@Controller('customer/orders')
export class CustomerOrderHistoryController {
  constructor(
    @Inject(VENDOR_FULFILMENT) private readonly fulfilment: VendorFulfilmentService,
    @Inject(ASSIGNMENT_CUSTODY) private readonly assignments: AssignmentCustodyService,
    @Inject(SUPPORT_CASES) private readonly supportCases: SupportCaseService,
  ) {}

  @Get()
  @customerRead
  async list() {
    try {
      return {
        groups: await this.fulfilment.listCustomerOrders({ context: currentRequestContext() }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  /** What cancelling would do, before the customer commits to it. */
  @Get(':vendor_order_id/cancellation-preview')
  @customerRead
  async cancellationPreview(@Param('vendor_order_id') orderId: string) {
    try {
      return await this.fulfilment.previewCancellation({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/cancel')
  @customerDecide
  @HttpCode(200)
  async cancel(@Param('vendor_order_id') orderId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      return await this.fulfilment.cancelByCustomer({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        expected_version: integerField(body, 'expected_version'),
        reason_code: stringField(body, 'reason_code'),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  /**
   * The customer's collection code for a pickup order (CUS-51).
   *
   * A POST for the same reasons as the delivery code: it mints a fresh value,
   * which is a state change, and keeps the code out of the URL.
   */
  @Post(':vendor_order_id/pickup-otp')
  @customerDecide
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async pickupOtp(@Param('vendor_order_id') orderId: string) {
    try {
      return await this.fulfilment.issueCustomerPickupOtp({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  /**
   * The customer's delivery code (CUS-56).
   *
   * A POST, not a GET: each call mints a fresh code and spends the previous
   * one, which is a state change, and it keeps the code out of a URL and so out
   * of history, referrers and access logs (SEC-09).
   */
  @Post(':vendor_order_id/delivery-otp')
  @customerDecide
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async deliveryOtp(@Param('vendor_order_id') orderId: string) {
    try {
      // A self-delivery has no assignment to hang the code on, so it lives on
      // the order. Whichever leg it is, the customer opens one screen.
      const method = await this.fulfilment.fulfilmentMethod(uuid(orderId));
      if (method === 'VENDOR_DELIVERY') {
        return await this.fulfilment.issueVendorDeliveryOtp({
          context: currentRequestContext(),
          vendor_order_id: uuid(orderId),
        });
      }
      return await this.assignments.issueDeliveryOtp({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  /** Coarse delivery stage. Never the partner's identity or live position. */
  @Get(':vendor_order_id/tracking')
  @customerRead
  async tracking(@Param('vendor_order_id') orderId: string) {
    try {
      return await this.fulfilment.customerTracking({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get(':vendor_order_id/receipt')
  @customerRead
  async receipt(@Param('vendor_order_id') orderId: string) {
    try {
      return await this.fulfilment.getReceipt({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
      });
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/rating')
  @customerRate
  async rate(@Param('vendor_order_id') orderId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      await this.fulfilment.submitRating({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        stars: integerField(body, 'stars'),
        ...(optionalString(body, 'review_note') !== undefined
          ? { review_note: optionalString(body, 'review_note') as string }
          : {}),
      });
      return { rated: true };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Post(':vendor_order_id/support')
  @customerSupport
  async support(@Param('vendor_order_id') orderId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      const lineId = optionalString(body, 'vendor_order_line_id');
      // A second report of the same trouble lands on the open case (11.3).
      const opened = await this.supportCases.open({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        category: stringField(body, 'category'),
        description: stringField(body, 'description'),
        ...(lineId !== undefined ? { vendor_order_line_id: uuid(lineId) } : {}),
      });
      return { support_case_id: opened.support_case_id, deduplicated: opened.deduplicated };
    } catch (error) {
      translateDomainError(error);
    }
  }
}
