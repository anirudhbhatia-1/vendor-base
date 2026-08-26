import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  CatalogueImportConflictError,
  CatalogueImportInputError,
  CatalogueProductNotFoundError,
  CatalogueProductService,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CATALOGUE_PRODUCTS } from './tokens.js';

function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function text(value: Record<string, unknown>, name: string): string {
  if (typeof value[name] !== 'string') throw new BadRequestException();
  return value[name];
}
function integer(value: Record<string, unknown>, name: string): number {
  if (!Number.isSafeInteger(value[name])) throw new BadRequestException();
  return value[name] as number;
}
function boolean(value: Record<string, unknown>, name: string): boolean {
  if (typeof value[name] !== 'boolean') throw new BadRequestException();
  return value[name];
}
function nullableInteger(value: Record<string, unknown>, name: string): number | null {
  if (value[name] === null || value[name] === undefined) return null;
  return integer(value, name);
}
const managesCatalogue = RequireAuthorization({
  capability: 'vendor.catalogue.manage',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});

@Controller('vendor/locations/:vendor_location_id/catalogue/products')
export class CatalogueProductsController {
  constructor(@Inject(CATALOGUE_PRODUCTS) private readonly catalogue: CatalogueProductService) {}

  @Get()
  @managesCatalogue
  list(@Param('vendor_location_id') vendorLocationId: string) {
    return this.catalogue.listProducts({
      context: currentRequestContext(),
      vendor_location_id: uuid(vendorLocationId),
    });
  }

  @Post()
  @managesCatalogue
  async create(@Param('vendor_location_id') vendorLocationId: string, @Body() raw: unknown) {
    const value = record(raw);
    try {
      return await this.catalogue.createProduct({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        product_reference: text(value, 'product_reference'),
        title: text(value, 'title'),
        category: text(value, 'category'),
        unit_label: text(value, 'unit_label'),
        tax_basis: text(value, 'tax_basis'),
        variable_weight: boolean(value, 'variable_weight'),
        permitted_weight_variance_bps: nullableInteger(value, 'permitted_weight_variance_bps'),
        sku: text(value, 'sku'),
        variant_title: text(value, 'variant_title'),
        price_minor: integer(value, 'price_minor'),
      });
    } catch (error) {
      this.map(error);
    }
  }

  @Put(':catalogue_product_id')
  @managesCatalogue
  async update(
    @Param('vendor_location_id') vendorLocationId: string,
    @Param('catalogue_product_id') productId: string,
    @Body() raw: unknown,
  ) {
    const value = record(raw);
    try {
      return await this.catalogue.updateProduct({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_product_id: uuid(productId),
        expected_version: integer(value, 'expected_version'),
        title: text(value, 'title'),
        category: text(value, 'category'),
        unit_label: text(value, 'unit_label'),
        tax_basis: text(value, 'tax_basis'),
        variable_weight: boolean(value, 'variable_weight'),
        permitted_weight_variance_bps: nullableInteger(value, 'permitted_weight_variance_bps'),
      });
    } catch (error) {
      this.map(error);
    }
  }

  @Post(':catalogue_product_id/:action')
  @managesCatalogue
  async lifecycle(
    @Param('vendor_location_id') vendorLocationId: string,
    @Param('catalogue_product_id') productId: string,
    @Param('action') action: string,
    @Body() raw: unknown,
  ) {
    if (action !== 'activate' && action !== 'deactivate') throw new NotFoundException();
    const value = record(raw);
    try {
      return await this.catalogue.setLifecycle({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_product_id: uuid(productId),
        expected_version: integer(value, 'expected_version'),
        lifecycle_state: action === 'activate' ? 'ACTIVE' : 'INACTIVE',
      });
    } catch (error) {
      this.map(error);
    }
  }

  @Post(':catalogue_product_id/images')
  @managesCatalogue
  async image(
    @Param('vendor_location_id') vendorLocationId: string,
    @Param('catalogue_product_id') productId: string,
    @Body() raw: unknown,
  ) {
    const value = record(raw);
    try {
      return await this.catalogue.addImage({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_product_id: uuid(productId),
        object_reference: text(value, 'object_reference'),
        alt_text: text(value, 'alt_text'),
        position: integer(value, 'position'),
      });
    } catch (error) {
      this.map(error);
    }
  }

  @Post('variants/:catalogue_variant_id/substitutions')
  @managesCatalogue
  async substitution(
    @Param('vendor_location_id') vendorLocationId: string,
    @Param('catalogue_variant_id') variantId: string,
    @Body() raw: unknown,
  ) {
    const value = record(raw);
    try {
      return await this.catalogue.setSubstitution({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_variant_id: uuid(variantId),
        replacement_variant_id: uuid(text(value, 'replacement_variant_id')),
        reason: text(value, 'reason'),
        active: boolean(value, 'active'),
      });
    } catch (error) {
      this.map(error);
    }
  }

  private map(error: unknown): never {
    if (error instanceof CatalogueImportInputError) throw new BadRequestException();
    if (error instanceof CatalogueProductNotFoundError) throw new NotFoundException();
    if (error instanceof CatalogueImportConflictError) throw new ConflictException();
    throw error;
  }
}
