'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Address, SearchResult } from '@neighbourhood-store/contracts';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SearchField,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import {
  anonymousCustomerClient,
  customerApiClient,
  readCustomerSession,
} from './customer-session';
import { displayLabel } from './display';
import { readBrowseLocation } from './browse-location';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const signedIn = Boolean(readCustomerSession());
      const work = signedIn
        ? customerApiClient().then(async (client) => {
            const addresses = (await client.addresses.list()).addresses;
            const selected: Address | undefined = addresses.find((item) => item.is_selected);
            if (!selected) throw new Error('Choose a delivery address before searching.');
            return client.discovery.search({
              customer_address_id: selected.customer_address_id,
              term,
              limit: 30,
              available_only: true,
            });
          })
        : Promise.resolve().then(() => {
            const location = readBrowseLocation();
            if (!location)
              throw new Error('Choose your location on Home before searching nearby stores.');
            return anonymousCustomerClient().catalogue.search({
              ...location,
              term,
              limit: 30,
              available_only: true,
            });
          });
      void work
        .then((body) => {
          if (active) setResults(body.results);
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : 'Search failed.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="ns-stack">
      <PageHeader
        description="Search products currently available from serviceable nearby stores."
        eyebrow="Marketplace"
        title="Search"
      />
      <SearchField
        label="Search products"
        onChange={setQuery}
        onSubmit={() => undefined}
        placeholder="Try tomato, atta or milk"
        submitLabel="Search"
        value={query}
      />
      {loading ? <LoadingState label="Searching nearby stores…" lines={4} /> : null}
      {error ? <ErrorState title={error} /> : null}
      {!loading && !error && query.trim().length >= 2 && results.length === 0 ? (
        <EmptyState
          description="Try a shorter name or another spelling."
          glyph="⌕"
          title="No matching products"
        />
      ) : null}
      <div className="ns-stack">
        {results.map((result) => (
          <Card
            as="article"
            key={`${result.vendor_location_id}-${result.catalogue_variant_id}`}
            tone="sunken"
          >
            <div className="ns-row">
              <div>
                <strong>
                  <Link
                    href={`/stores/${result.vendor_location_id}/products/${result.catalogue_product_id}`}
                  >
                    {displayLabel(result.title)}
                  </Link>
                </strong>
              </div>
              <strong>
                {result.price_minor === null
                  ? 'Price unavailable'
                  : formatMoneyMinor(result.price_minor)}
              </strong>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
