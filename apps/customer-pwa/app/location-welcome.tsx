'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Icon, Notice } from '@neighbourhood-store/ui';
import { requestDeviceLocation, type BrowseLocation } from './browse-location';
import { useLocale } from './locale';

export function LocationWelcome({
  onLocated,
}: {
  readonly onLocated: (location: BrowseLocation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();
  return (
    <section className="location-welcome" aria-labelledby="location-title">
      <div className="location-welcome__intro">
        <span className="eyebrow">
          {t('customer.welcome.eyebrow', 'Your neighbourhood, your shops')}
        </span>
        <h1 id="location-title">
          {t('customer.welcome.title', 'Everyday essentials. From shops around you.')}
        </h1>
        <p>
          {t(
            'customer.welcome.description',
            'Find the grocers, fruit sellers and everyday stores that serve your area. See who you’re buying from, before anything goes in your basket.',
          )}
        </p>
        <div className="location-welcome__strip" aria-label="How shopping works">
          <span>
            <Icon name="store" /> {t('customer.welcome.stores', 'Choose a local shop')}
          </span>
          <span>
            <Icon name="basket" /> {t('customer.welcome.basket', 'Build your basket')}
          </span>
          <span>
            <Icon name="truck" /> {t('customer.welcome.delivery', 'Review delivery or pickup')}
          </span>
        </div>
      </div>
      <div className="location-welcome__choice">
        <span className="location-welcome__pin">
          <Icon name="pin" />
        </span>
        <h2>{t('customer.location.title', 'Where are you shopping from?')}</h2>
        <p>
          {t(
            'customer.welcome.location_help',
            'We’ll use your location to check which shops can reach you. Your delivery address is confirmed separately at checkout.',
          )}
        </p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button
          block
          busy={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void requestDeviceLocation()
              .then((result) => {
                if (result.ok) onLocated(result.location);
                else setError(result.reason);
              })
              .catch(() => setError('Location is unavailable. Try again or use a saved address.'))
              .finally(() => setBusy(false));
          }}
        >
          {t('customer.location.use_device', 'Use my location')}
        </Button>
        <Link
          className="ns-button ns-button--secondary ns-button--medium"
          href="/login?next=%2Faddresses"
        >
          {t('customer.welcome.saved_address', 'Sign in to use a saved address')}
        </Link>
        <small>
          {t(
            'customer.welcome.permission',
            'Location permission is optional. You can also add an address after signing in.',
          )}
        </small>
      </div>
    </section>
  );
}
