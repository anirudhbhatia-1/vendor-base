'use client';

import Link from 'next/link';
import { Icon, PageHeader, type IconName } from '@neighbourhood-store/ui';
import { useLocale } from './locale';

export function AccountPanel() {
  const { t } = useLocale();
  return (
    <div className="ns-stack">
      <PageHeader
        description={t(
          'customer.account.description',
          'Manage your deliveries, find help, and make your account work for you.',
        )}
        eyebrow={t('customer.account.eyebrow', 'Account')}
        title={t('customer.account.hub.title', 'Your account')}
      />
      <div className="account-link-grid">
        {(
          [
            ['/orders', 'Your orders', 'Track a delivery, view a receipt or buy again.', 'basket'],
            [
              '/addresses',
              'Delivery addresses',
              'Choose where your neighbourhood shops deliver.',
              'pin',
            ],
            ['/stores', 'Saved stores', 'Return to the local shops you have saved.', 'heart'],
            [
              '/notifications',
              'Notifications',
              'Order, delivery, refund and support updates.',
              'clock',
            ],
            ['/support', 'Help and support', 'Follow a case or continue a conversation.', 'person'],
            [
              '/account/preferences',
              'Profile and preferences',
              'Your name, language, alerts and sign-out controls.',
              'person',
            ],
            [
              '/sessions',
              'Signed-in devices',
              'Review devices and revoke access you no longer use.',
              'grid',
            ],
            ['/privacy', 'Privacy controls', 'Request your data or account deletion.', 'leaf'],
          ] as const
        ).map(([href, title, description, icon]) => (
          <Link className="account-task" href={href} key={href}>
            <span className="account-task__icon">
              <Icon name={icon as IconName} />
            </span>
            <span>
              <strong>{t(`customer.account.link.${href}`, title)}</strong>
              <small>{t(`customer.account.description.${href}`, description)}</small>
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
