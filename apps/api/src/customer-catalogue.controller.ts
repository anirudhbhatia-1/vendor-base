import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { CatalogueProductService, CustomerDiscoveryService } from '@neighbourhood-store/database';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import type { FastifyReply } from 'fastify';
import { CATALOGUE_PRODUCTS, CUSTOMER_DISCOVERY } from './tokens.js';
import { RUNTIME_CONFIG, type RuntimeConfig } from './runtime-config.js';
import { translateDomainError } from './domain-errors.js';

function requireQuery(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') throw new BadRequestException();
  return value;
}

@Controller('customer/discovery/categories')
export class CustomerCategoriesController {
  constructor(@Inject(CATALOGUE_PRODUCTS) private readonly catalogue: CatalogueProductService) {}

  @Get()
  async list() {
    const categories = await this.catalogue.listCategories();
    return { categories };
  }
}

/**
 * Serves published catalogue photographs.
 *
 * Unauthenticated by design. A storefront image is Public data under the
 * architecture's classification (§17) — the same class as the store name and
 * published catalogue it belongs to — and requiring a session would mean the
 * server-rendered store pages could not show a product. Vendor verification
 * documents live in the same object store and remain behind an authenticated,
 * granted path; nothing here can reach them, because the lookup is by
 * `catalogue_image_id` against the catalogue table and the object key is never
 * accepted from the caller.
 */
@Controller('customer/catalogue/images')
export class CustomerCatalogueImageController {
  constructor(@Inject(CATALOGUE_PRODUCTS) private readonly catalogue: CatalogueProductService) {}

  @Get(':catalogue_image_id')
  async image(
    @Param('catalogue_image_id') imageId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    let parsed;
    try {
      parsed = parseUuidV7(imageId);
    } catch {
      throw new BadRequestException();
    }
    const found = await this.catalogue.readPublishedImage({ catalogue_image_id: parsed });
    // Missing, unpublished and unstored are one answer, so a caller cannot
    // enumerate which products exist by watching the status code change.
    if (!found) throw new NotFoundException();
    await reply
      .header('content-type', found.media_type)
      // Immutable: an image's bytes never change under a given id — a replaced
      // photograph is a new row with a new id — so a client may keep it.
      .header('cache-control', 'public, max-age=86400, immutable')
      .header('etag', `"${found.content_sha256}"`)
      // The bytes are attacker-influenced content from a vendor upload; these
      // stop a browser from ever treating them as anything but an image.
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(Buffer.from(found.bytes));
  }
}

/**
 * Store discovery and product search before sign-in.
 *
 * `architecture.md` §6.1 asks for public store pages "for fast loading and
 * discoverability", and CUS-08 makes location permission optional — but every
 * discovery route required `customer.discovery.use`, and the feed needed a
 * *saved address*, so a visitor had to create an account and store an address
 * before a single shop appeared. That is the login wall no shopping app puts in
 * front of its catalogue.
 *
 * Unauthenticated by design, and deliberately narrow: these return Public data
 * under the architecture's classification (§17) — published store, catalogue,
 * price, availability. Everything personal (favourites, preferred store, recent
 * searches, cart, orders) stays on the authenticated
 * `customer/discovery/*` routes, which are unchanged.
 */
/**
 * What a browser needs to draw a map and search for a place (D-17): the
 * provider and its public token. The token is a Mapbox `pk.` token -- scoped
 * and made to be used from a browser -- read from the same environment the
 * routing service uses, so no shell has to carry it at build time. When no
 * provider is configured, every picker falls back to hand-entered
 * coordinates and says so.
 */
@Controller('catalogue/maps')
export class MapsConfigController {
  constructor(@Inject(RUNTIME_CONFIG) private readonly runtime: RuntimeConfig) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  config() {
    const routing = this.runtime.routing;
    const publicToken =
      routing.provider === 'mapbox' && routing.mapboxAccessToken?.startsWith('pk.')
        ? routing.mapboxAccessToken
        : null;
    return {
      provider: publicToken ? ('mapbox' as const) : ('none' as const),
      access_token: publicToken,
      country: 'in',
      // Jaipur, the synthetic launch area, where a map opens before a point is chosen.
      default_centre: { latitude: 26.9124, longitude: 75.7873 },
    };
  }
}

@Controller('catalogue')
export class PublicDiscoveryController {
  constructor(@Inject(CUSTOMER_DISCOVERY) private readonly discovery: CustomerDiscoveryService) {}

  @Get('stores')
  async stores(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      return {
        stores: await this.discovery.discoverStoresNear({
          latitude: Number(requireQuery(latitude)),
          longitude: Number(requireQuery(longitude)),
          ...(limit !== undefined ? { limit: Number(limit) } : {}),
          ...(offset !== undefined ? { offset: Number(offset) } : {}),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('search')
  async search(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
    @Query('term') term: string,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
    @Query('available_only') availableOnly?: string,
    @Query('fulfilment_mode') fulfilmentMode?: string,
    @Query('max_distance_meters') maxDistance?: string,
  ) {
    try {
      return {
        results: await this.discovery.searchProductsNear({
          latitude: Number(requireQuery(latitude)),
          longitude: Number(requireQuery(longitude)),
          term: requireQuery(term),
          ...(limit !== undefined ? { limit: Number(limit) } : {}),
          ...(category ? { category } : {}),
          ...(availableOnly !== undefined ? { available_only: availableOnly === 'true' } : {}),
          ...(fulfilmentMode ? { fulfilment_mode: fulfilmentMode } : {}),
          ...(maxDistance !== undefined ? { max_distance_meters: Number(maxDistance) } : {}),
        }),
      };
    } catch (error) {
      translateDomainError(error);
    }
  }

  @Get('stores/:vendor_location_id')
  async storefront(@Param('vendor_location_id') locationId: string) {
    let parsed;
    try {
      parsed = parseUuidV7(locationId);
    } catch {
      throw new BadRequestException();
    }
    try {
      return await this.discovery.publicStorefront({ vendor_location_id: parsed });
    } catch (error) {
      translateDomainError(error);
    }
  }
}
