/**
 * Which workspace an app hosts, and what it may open (the Android shells).
 *
 * Each role's Android app is a native shell around that role's PWA: the
 * workflows are the web's, the device states -- offline, the back button,
 * external links, the location permission -- are the shell's. Nothing here
 * decides anything about permissions, prices or workflow: the URL is the
 * whole configuration, and the API remains the authority behind it.
 */
export type WorkspaceRole = 'customer' | 'vendor' | 'partner' | 'admin';

/** The company-test deployments each shell points at unless the build says otherwise. */
export const DEFAULT_WORKSPACE_URLS: Readonly<Record<WorkspaceRole, string>> = Object.freeze({
  customer: 'https://shop.bravebay-be9940ed.centralindia.azurecontainerapps.io',
  vendor: 'https://nbhdvendortest.z29.web.core.windows.net',
  partner: 'https://nbhdpartnertest.z29.web.core.windows.net',
  admin: 'https://nbhdadmintest.z29.web.core.windows.net',
});

export const WORKSPACE_TITLES: Readonly<Record<WorkspaceRole, string>> = Object.freeze({
  customer: 'Neighbourhood Store',
  vendor: 'Neighbourhood Store · Vendor',
  partner: 'Neighbourhood Store · Delivery partner',
  admin: 'Neighbourhood Store · Operations',
});

export class WorkspaceConfigError extends Error {}

/**
 * The workspace URL for a role: `EXPO_PUBLIC_WORKSPACE_URL` when the build
 * sets it (a local dev server, another environment), else the company-test
 * deployment. Only https is accepted, except a loopback dev server.
 */
export function resolveWorkspaceUrl(
  role: WorkspaceRole,
  env: Readonly<Record<string, string | undefined>> = {},
): string {
  const configured = env['EXPO_PUBLIC_WORKSPACE_URL']?.trim();
  const candidate = configured && configured.length > 0 ? configured : DEFAULT_WORKSPACE_URLS[role];
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new WorkspaceConfigError(`The workspace URL is not a URL: ${candidate}`);
  }
  const loopback = ['localhost', '127.0.0.1', '10.0.2.2'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new WorkspaceConfigError('The workspace must be served over https');
  }
  return parsed.origin;
}

/**
 * Whether a navigation stays inside the hosted workspace. Same origin loads
 * in the shell; anything else -- a map handoff (`geo:`), a call (`tel:`), a
 * document on another host -- is handed to the device.
 */
export function staysInWorkspace(target: string, workspaceUrl: string): boolean {
  try {
    const url = new URL(target);
    if (url.protocol === 'about:' || url.protocol === 'blob:' || url.protocol === 'data:')
      return true;
    return url.origin === new URL(workspaceUrl).origin;
  } catch {
    return false;
  }
}

/** A deep link on the app's own scheme, mapped to the workspace path it names. */
export function deepLinkToPath(link: string, scheme: string): string | null {
  try {
    const url = new URL(link);
    if (url.protocol !== `${scheme}:`) return null;
    // `scheme://active` parses with `active` as the host; `scheme:///active` as the path.
    const host = url.hostname ? `/${url.hostname}` : '';
    const path = `${host}${url.pathname}`.replace(/\/+$/, '') || '/';
    if (!/^\/[A-Za-z0-9/_-]*$/.test(path)) return null;
    return `${path}${url.search}`;
  } catch {
    return null;
  }
}

/** What the shell says with no connection: the work waits, and so does the app. */
export function offlineSentence(role: WorkspaceRole): string {
  switch (role) {
    case 'partner':
      return 'No connection. A delivery you record now is held on this device until you have signal.';
    case 'vendor':
      return 'No connection. Actions you take are held and sent when you reconnect.';
    case 'admin':
      return 'No connection. The queues will refresh when you reconnect.';
    default:
      return 'No connection. Your basket and orders will refresh when you reconnect.';
  }
}
