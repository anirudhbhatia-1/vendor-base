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
import { RequireAuthorization } from './authorization.js';
import { CATALOGUE_PRODUCTS } from './tokens.js';
import { currentRequestContext } from './request-context-storage.js';
import { object, stringField, uuid } from './request-fields.js';
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
    const value = object(raw);
    try {
      return await this.catalogue.stageImport({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        source_filename: stringField(value, 'source_filename'),
        csv_content: stringField(value, 'csv_content'),
        idempotency_key: stringField(value, 'idempotency_key'),
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
      if (error instanceof CatalogueImportConflictError)
        throw new ConflictException({ error_code: 'ORDER_STATE_CONFLICT' });
      throw error;
    }
  }
}
