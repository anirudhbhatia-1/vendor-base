'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Notice } from './states.js';

export type ServiceBannerItem = {
  readonly control_key: string;
  readonly scope_reference: string;
  readonly message: string;
  readonly until: string;
};

/**
 * What operations have paused, on every surface it touches (11.7). Each
 * banner is the operator's own sentence and when it lapses at the latest.
 */
export function ServiceBanners({
  banners,
  untilLabel = (until) => `Until ${new Date(until).toLocaleString()} at the latest.`,
}: {
  readonly banners: readonly ServiceBannerItem[];
  readonly untilLabel?: (until: string) => ReactNode;
}) {
  if (banners.length === 0) return null;
  return (
    <div className="ns-service-banners" aria-label="Service status">
      {banners.map((banner) => (
        <Notice key={`${banner.control_key}-${banner.scope_reference}`} tone="warning">
          {banner.message} {untilLabel(banner.until)}
        </Notice>
      ))}
    </div>
  );
}

/**
 * The banners, read now and every minute, from whatever the surface's own
 * client returns. A failed read shows nothing rather than a stale pause.
 */
export function LiveServiceBanners({
  load,
}: {
  readonly load: () => Promise<readonly ServiceBannerItem[]>;
}) {
  const [banners, setBanners] = useState<readonly ServiceBannerItem[]>([]);
  useEffect(() => {
    let live = true;
    const read = () =>
      load().then(
        (next) => {
          if (live) setBanners(next);
        },
        () => {
          if (live) setBanners([]);
        },
      );
    void read();
    const timer = setInterval(() => void read(), 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [load]);
  return <ServiceBanners banners={banners} />;
}
