import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  FulfilmentAuthorizationError,
  FulfilmentConflictError,
  FulfilmentInputError,
  FulfilmentNotFoundError,
  PickupOtpExhaustedError,
  PickupOtpExpiredError,
  PickupOtpMismatchError,
  VendorFulfilmentService,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { VENDOR_FULFILMENT } from './tokens.js';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function stringField(body: Record<string, unknown>, key: string): string {
  const found = body[key];
  if (typeof found !== 'string') throw new BadRequestException();
  return found;
}
function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const found = body[key];
  if (found === undefined || found === null) return undefined;
  if (typeof found !== 'string') throw new BadRequestException();
  return found;
}
function integerField(body: Record<string, unknown>, key: string): number {
  const found = body[key];
  if (!Number.isSafeInteger(found)) throw new BadRequestException();
  return found as number;
}
function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function map(error: unknown): never {
  if (error instanceof FulfilmentInputError) throw new BadRequestException(error.message);
  if (error instanceof FulfilmentNotFoundError) throw new NotFoundException();
  if (error instanceof FulfilmentConflictError) throw new ConflictException(error.message);
  if (error instanceof FulfilmentAuthorizationError) throw new ForbiddenException();
  if (error instanceof PickupOtpMismatchError) throw new ConflictException('OTP_MISMATCH');
  if (error instanceof PickupOtpExhaustedError) throw new ConflictException('OTP_EXHAUSTED');
  if (error instanceof PickupOtpExpiredError) throw new ConflictException('OTP_EXPIRED');
  throw error;
}

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

@Controller('vendor/locations/:vendor_location_id/orders')
export class VendorOrderFulfilmentController {
  constructor(@Inject(VENDOR_FULFILMENT) private readonly fulfilment: VendorFulfilmentService) {}

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
      map(error);
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
      map(error);
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
      map(error);
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
      });
    } catch (error) {
      map(error);
    }
  }

  @Post(':vendor_order_id/lines/:vendor_order_line_id/missing')
  @vendorFulfil
  async markMissing(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
    @Param('vendor_order_line_id') lineId: string,
  ) {
    try {
      return await this.fulfilment.markLineMissing({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
        vendor_order_line_id: uuid(lineId),
      });
    } catch (error) {
      map(error);
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
      });
    } catch (error) {
      map(error);
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
      });
    } catch (error) {
      map(error);
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
      });
    } catch (error) {
      map(error);
    }
  }

  @Post(':vendor_order_id/pickup-otp')
  @vendorFulfil
  async issueOtp(
    @Param('vendor_location_id') locationId: string,
    @Param('vendor_order_id') orderId: string,
  ) {
    try {
      return await this.fulfilment.issuePickupOtp({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        vendor_location_id: uuid(locationId),
      });
    } catch (error) {
      map(error);
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
      map(error);
    }
  }

  @Get(':vendor_order_id/picks')
  @vendorFulfil
  async listPicks(
    @Param('vendor_location_id') _locationId: string,
    @Param('vendor_order_id') orderId: string,
  ) {
    try {
      return {
        picks: await this.fulfilment.listPicks({
          context: currentRequestContext(),
          vendor_order_id: uuid(orderId),
        }),
      };
    } catch (error) {
      map(error);
    }
  }
}

@Controller('customer/decisions')
export class CustomerDecisionsController {
  constructor(@Inject(VENDOR_FULFILMENT) private readonly fulfilment: VendorFulfilmentService) {}

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
      map(error);
    }
  }
}

@Controller('customer/orders')
export class CustomerOrderHistoryController {
  constructor(@Inject(VENDOR_FULFILMENT) private readonly fulfilment: VendorFulfilmentService) {}

  @Get()
  @customerRead
  async list() {
    try {
      return {
        groups: await this.fulfilment.listCustomerOrders({ context: currentRequestContext() }),
      };
    } catch (error) {
      map(error);
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
      map(error);
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
      map(error);
    }
  }

  @Post(':vendor_order_id/support')
  @customerSupport
  async support(@Param('vendor_order_id') orderId: string, @Body() raw: unknown) {
    const body = object(raw);
    try {
      const supportCaseId = await this.fulfilment.openSupportCase({
        context: currentRequestContext(),
        vendor_order_id: uuid(orderId),
        category: stringField(body, 'category'),
        description: stringField(body, 'description'),
      });
      return { support_case_id: supportCaseId };
    } catch (error) {
      map(error);
    }
  }
}
