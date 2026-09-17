import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell, TabBar } from '@neighbourhood-store/ui';
import { AccountPanel } from './account-panel';
import { LocationWelcome } from './location-welcome';
import { LocaleProvider } from './locale';

function navigation(path: string) {
  return renderToStaticMarkup(
    createElement(TabBar, {
      currentPath: path,
      items: [
        { href: '/', label: 'Home', glyph: null },
        { href: '/orders', label: 'Orders', glyph: null },
        { href: '/account', label: 'Account', glyph: null, relatedPaths: ['/addresses'] },
      ],
      renderLink: (item, active, content) =>
        createElement(
          'a',
          { href: item.href, 'aria-current': active ? 'page' : undefined },
          content,
        ),
    }),
  );
}

test('nested order and related account routes retain exactly one active tab', () => {
  for (const [path, href] of [
    ['/orders/123/track', '/orders'],
    ['/addresses', '/account'],
    ['/account/preferences', '/account'],
    ['/', '/'],
  ]) {
    const html = navigation(path ?? '/');
    assert.ok(html.includes(`href="${href}" aria-current="page"`));
    assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  }
  assert.ok(!navigation('/orders-archive').includes('aria-current'));
});

test('shell keyboard order places navigation before main content', () => {
  const html = renderToStaticMarkup(
    createElement(AppShell, {
      surface: 'customer',
      topBar: 'Brand',
      tabs: createElement('nav', null, 'Primary'),
      children: 'Shopping',
    }),
  );
  assert.ok(html.indexOf('<nav') < html.indexOf('<main'));
});

test('account hub exposes dedicated tasks without embedding the sign-in/settings form', () => {
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, null, createElement(AccountPanel)),
  );
  for (const route of [
    '/orders',
    '/addresses',
    '/notifications',
    '/support',
    '/sessions',
    '/privacy',
    '/account/preferences',
  ]) {
    assert.ok(html.includes(`href="${route}"`), route);
  }
  assert.ok(!html.includes('<form'));
});

test('location welcome offers an explicit non-permission path and no invented stores', () => {
  const html = renderToStaticMarkup(
    createElement(
      LocaleProvider,
      null,
      createElement(LocationWelcome, { onLocated: () => undefined }),
    ),
  );
  assert.ok(html.includes('Use my location'));
  assert.ok(html.includes('href="/login?next=%2Faddresses"'));
  assert.ok(html.includes('Location permission is optional'));
  assert.ok(!html.includes('SYNTH-'));
});
