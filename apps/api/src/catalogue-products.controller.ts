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
import { RequireAuthorization } from './authorization.js';
import { currentRequestContext } from './request-context-storage.js';
import { CATALOGUE_PRODUCTS } from './tokens.js';
import {
  booleanField,
  integerField,
  nullableInteger,
  object,
  optionalInteger,
  stringField,
  uuid,
} from './request-fields.js';
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
    const value = object(raw);
    try {
      const initialStock = optionalInteger(value, 'initial_stock_quantity');
      const lowThreshold = optionalInteger(value, 'low_stock_threshold');
      return await this.catalogue.createProduct({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        product_reference: stringField(value, 'product_reference'),
        title: stringField(value, 'title'),
        category: stringField(value, 'category'),
        unit_label: stringField(value, 'unit_label'),
        tax_basis: stringField(value, 'tax_basis'),
        variable_weight: booleanField(value, 'variable_weight'),
        permitted_weight_variance_bps: nullableInteger(value, 'permitted_weight_variance_bps'),
        sku: stringField(value, 'sku'),
        variant_title: stringField(value, 'variant_title'),
        price_minor: integerField(value, 'price_minor'),
        ...(initialStock !== undefined ? { initial_stock_quantity: initialStock } : {}),
        ...(lowThreshold !== undefined ? { low_stock_threshold: lowThreshold } : {}),
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
    const value = object(raw);
    try {
      return await this.catalogue.updateProduct({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_product_id: uuid(productId),
        expected_version: integerField(value, 'expected_version'),
        title: stringField(value, 'title'),
        category: stringField(value, 'category'),
        unit_label: stringField(value, 'unit_label'),
        tax_basis: stringField(value, 'tax_basis'),
        variable_weight: booleanField(value, 'variable_weight'),
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
    const value = object(raw);
    try {
      return await this.catalogue.setLifecycle({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_product_id: uuid(productId),
        expected_version: integerField(value, 'expected_version'),
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
    const value = object(raw);
    try {
      return await this.catalogue.addImage({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_product_id: uuid(productId),
        object_reference: stringField(value, 'object_reference'),
        alt_text: stringField(value, 'alt_text'),
        position: integerField(value, 'position'),
      });
    } catch (error) {
      this.map(error);
    }
  }

  @Post(':catalogue_product_id/image-upload')
  @managesCatalogue
  async uploadImage(
    @Param('vendor_location_id') vendorLocationId: string,
    @Param('catalogue_product_id') productId: string,
    @Body() raw: unknown,
  ) {
    const value = object(raw);
    const mediaType = stringField(value, 'media_type');
    if (mediaType !== 'image/png' && mediaType !== 'image/jpeg') {
      throw new BadRequestException('media_type must be image/png or image/jpeg');
    }
    const base64 = stringField(value, 'content_base64');
    // Match the base64 decoder used in vendor onboarding for consistency.
    if (
      base64.length === 0 ||
      base64.length > 7_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    ) {
      throw new BadRequestException('content_base64 is invalid');
    }
    const buffer = Buffer.from(base64, 'base64');
    const canonical = buffer.toString('base64').replace(/=+$/, '');
    if (canonical !== base64.replace(/=+$/, '')) throw new BadRequestException();
    try {
      return await this.catalogue.uploadImage({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_product_id: uuid(productId),
        content: new Uint8Array(buffer),
        media_type: mediaType,
        alt_text: stringField(value, 'alt_text'),
        position: integerField(value, 'position'),
      });
    } catch (error) {
      this.map(error);
    }
  }

  @Put('variants/:catalogue_variant_id/price')
  @managesCatalogue
  async setPrice(
    @Param('vendor_location_id') vendorLocationId: string,
    @Param('catalogue_variant_id') variantId: string,
    @Body() raw: unknown,
  ) {
    const value = object(raw);
    try {
      return await this.catalogue.setVariantPrice({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_variant_id: uuid(variantId),
        price_minor: integerField(value, 'price_minor'),
        ...(typeof value['reason_code'] === 'string'
          ? { reason_code: stringField(value, 'reason_code') }
          : {}),
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
    const value = object(raw);
    try {
      return await this.catalogue.setSubstitution({
        context: currentRequestContext(),
        vendor_location_id: uuid(vendorLocationId),
        catalogue_variant_id: uuid(variantId),
        replacement_variant_id: uuid(stringField(value, 'replacement_variant_id')),
        reason: stringField(value, 'reason'),
        active: booleanField(value, 'active'),
      });
    } catch (error) {
      this.map(error);
    }
  }

  private map(error: unknown): never {
    if (error instanceof CatalogueImportInputError) throw new BadRequestException();
    if (error instanceof CatalogueProductNotFoundError) throw new NotFoundException();
    if (error instanceof CatalogueImportConflictError)
      throw new ConflictException({ error_code: 'ORDER_STATE_CONFLICT' });
    throw error;
  }
}
