'use client';
import { useRouter } from 'next/navigation';
import { WorkspaceLoginPage } from '@neighbourhood-store/pwa-auth/login';
import { apiUrl } from '../authenticated-api';
import { getSupabase, supabaseConfigured } from '../supabase-client';

export default function VendorLoginPage() {
  const router = useRouter();
  return (
    <WorkspaceLoginPage
      apiUrl={apiUrl}
      configured={supabaseConfigured()}
      getSupabase={getSupabase}
      homePath="/catalogue"
      lede="Signed sessions unlock the store desk."
      onSignedIn={(path) => {
        router.replace(path);
        router.refresh();
      }}
      title="Vendor sign in"
      workspaceRole="vendor"
    />
  );
}
