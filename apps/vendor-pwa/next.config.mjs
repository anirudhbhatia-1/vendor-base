import process from 'node:process';

const deploymentTarget = process.env.DEPLOYMENT_TARGET;
if (deploymentTarget !== undefined && deploymentTarget !== 'cloudflare-pages') {
  throw new Error('DEPLOYMENT_TARGET must be cloudflare-pages when set');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The static export is hosted where a request for `/catalogue` is only ever served
  // from `catalogue/index.html` (Azure Storage static websites, Cloudflare Pages), so
  // the export writes directory indexes and links with trailing slashes.
  ...(deploymentTarget === 'cloudflare-pages' ? { output: 'export', trailingSlash: true } : {}),
};

export default nextConfig;
