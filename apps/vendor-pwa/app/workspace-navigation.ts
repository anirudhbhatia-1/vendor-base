export const vendorPages = {
  orders: { href: '/', label: 'Orders', section: 'orders' },
  catalogue: { href: '/catalogue', label: 'Products', section: 'catalogue' },
  inventory: {
    href: '/catalogue/inventory',
    label: 'Stock and reservations',
    section: 'catalogue',
  },
  imports: { href: '/catalogue/imports', label: 'CSV import', section: 'catalogue' },
  store: { href: '/store', label: 'Store settings', section: 'store' },
  'service-area': {
    href: '/store/service-area',
    label: 'Delivery areas and closures',
    section: 'store',
  },
  staff: { href: '/store/staff', label: 'Staff and access', section: 'store' },
  payouts: { href: '/payouts', label: 'Payouts', section: 'payouts' },
  more: { href: '/more', label: 'More', section: 'more' },
  insights: { href: '/more/insights', label: 'Insights and support cases', section: 'more' },
  onboarding: { href: '/onboarding', label: 'Onboarding record', section: 'more' },
} as const;

export type VendorView = keyof typeof vendorPages;

export function vendorSectionPages(view: VendorView) {
  const section = vendorPages[view].section;
  return Object.entries(vendorPages).filter(([, page]) => page.section === section);
}
