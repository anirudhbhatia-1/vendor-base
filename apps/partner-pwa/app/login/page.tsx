'use client';
import { useRouter } from 'next/navigation';
import { WorkspaceLoginPage } from '@neighbourhood-store/pwa-auth/login';
import { apiUrl } from '../authenticated-api';
import { getSupabase, supabaseConfigured } from '../supabase-client';

export default function PartnerLoginPage() {
  const router = useRouter();
  return (
    <WorkspaceLoginPage
      apiUrl={apiUrl}
      configured={supabaseConfigured()}
      getSupabase={getSupabase}
      homePath="/"
      lede="Signed sessions unlock the custody desk."
      onSignedIn={(path) => {
        router.replace(path);
        router.refresh();
      }}
      title="Delivery partner sign in"
      workspaceRole="partner"
    />
  );
}
