import process from 'node:process';

const deploymentTarget = process.env.DEPLOYMENT_TARGET;
if (deploymentTarget !== undefined && deploymentTarget !== 'cloudflare-pages') {
  throw new Error('DEPLOYMENT_TARGET must be cloudflare-pages when set');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  ...(deploymentTarget === 'cloudflare-pages' ? { output: 'export' } : {}),
};

export default nextConfig;
