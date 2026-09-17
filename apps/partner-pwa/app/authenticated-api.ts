'use client';
import { workspaceAuth } from './supabase-client';

export const apiUrl = workspaceAuth.apiUrl;
export const partnerApiClient = workspaceAuth.apiClient;
export const partnerRequest = workspaceAuth.request;
