export const adminModuleGroups = [
  {
    label: 'Work',
    links: [
      ['/', 'Work queue'],
      ['/orders', 'Orders and dispatch'],
      ['/incidents', 'Incidents'],
    ],
  },
  {
    label: 'Network',
    links: [
      ['/onboarding', 'Onboarding'],
      ['/vendors', 'Vendors'],
      ['/partners', 'Partners'],
    ],
  },
  {
    label: 'Catalogue and service',
    links: [
      ['/catalogue', 'Catalogue'],
      ['/zones', 'Zones and policies'],
    ],
  },
  {
    label: 'Support and money',
    links: [
      ['/support', 'Support cases'],
      ['/trust', 'Trust and safety'],
      ['/finance', 'Finance and refunds'],
    ],
  },
  {
    label: 'Administration',
    links: [
      ['/access', 'Access'],
      ['/reporting', 'Reporting'],
      ['/audit', 'Audit log'],
    ],
  },
] as const;

export function activeAdminModule(pathname: string) {
  return adminModuleGroups
    .flatMap((group) => [...group.links])
    .filter(([href]) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`)))
    .sort(([a], [b]) => b.length - a.length)[0];
}
