import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  CATALOGUE_CSV_TEMPLATE,
  CatalogueImportAuthorizationError,
  CatalogueImportConflictError,
  CatalogueImportInputError,
  CatalogueImportNotFoundError,
  CatalogueProductService,
} from '@neighbourhood-store/database';
import { parseUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { RequireAuthorization } from './authorization.js';
import { CATALOGUE_PRODUCTS } from './tokens.js';
import { currentRequestContext } from './request-context-storage.js';

function uuid(value: string): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new BadRequestException();
  }
}
function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException();
  return value as Record<string, unknown>;
}
function string(value: Record<string, unknown>, name: string): string {
  if (typeof value[name] !== 'string') throw new BadRequestException();
  return value[name];
}
const managesCatalogue = RequireAuthorization({
  capability: 'vendor.catalogue.manage',
  conceal_resource: true,
  vendor_location_id_param: 'vendor_location_id',
});

@Controller('vendor/locations/:vendor_location_id/catalogue/imports')
export class CatalogueImportController {
  constructor(@Inject(CATALOGUE_PRODUCTS) private readonly catalogue: CatalogueProductService) {}
  @Get('template')
  @managesCatalogue
  template() {
    return { content: CATALOGUE_CSV_TEMPLATE, template_version: 'CATALOGUE_CSV_V1' };
  }
  @Post()
  @managesCatalogue
  async stage(@Param('vendor_location_id') vendorLocationId: string, @Body() raw: unknown) {
    const value = body(raw);
    try {
      return await this.catalogue.stageImport({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        source_filename: string(value, 'source_filename'),
        csv_content: string(value, 'csv_content'),
        idempotency_key: string(value, 'idempotency_key'),
      });
    } catch (error) {
      if (error instanceof CatalogueImportInputError) throw new BadRequestException();
      if (error instanceof CatalogueImportAuthorizationError) throw new BadRequestException();
      throw error;
    }
  }

  @Post(':catalogue_import_id/commit')
  @managesCatalogue
  async commit(
    @Param('vendor_location_id') vendorLocationId: string,
    @Param('catalogue_import_id') importId: string,
  ) {
    try {
      return await this.catalogue.commitImport({
        context: currentRequestContext(),
        catalogue_import_id: uuid(importId),
        vendor_location_id: uuid(vendorLocationId),
      });
    } catch (error) {
      if (error instanceof CatalogueImportInputError) throw new BadRequestException();
      if (error instanceof CatalogueImportAuthorizationError) throw new BadRequestException();
      if (error instanceof CatalogueImportNotFoundError) throw new BadRequestException();
      if (error instanceof CatalogueImportConflictError) throw new ConflictException();
      throw error;
    }
  }
}
