'use client';

import { useEffect, useState } from 'react';
import type { MapsConfig } from '@neighbourhood-store/contracts';
import { adminApiClient } from './authenticated-api';

/**
 * The map provider and its public token, from the API (D-17). Read once per
 * page; until it answers, or when it says there is no provider, a picker
 * shows its hand-entered fallback rather than an empty map.
 */
export function useMapsConfig(): MapsConfig | null {
  const [config, setConfig] = useState<MapsConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    adminApiClient()
      .then((client) => client.catalogue.mapsConfig())
      .then((answer) => {
        if (!cancelled) setConfig(answer);
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({
            provider: 'none',
            access_token: null,
            country: 'in',
            default_centre: { latitude: 26.9124, longitude: 75.7873 },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
