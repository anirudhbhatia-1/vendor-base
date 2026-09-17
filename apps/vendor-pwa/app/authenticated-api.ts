'use client';
import { workspaceAuth } from './supabase-client';

export const apiUrl = workspaceAuth.apiUrl;
export const vendorApiClient = workspaceAuth.apiClient;
export const vendorRequest = workspaceAuth.request;
