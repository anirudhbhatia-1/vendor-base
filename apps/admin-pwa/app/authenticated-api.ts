'use client';
import { workspaceAuth } from './supabase-client';

export const apiUrl = workspaceAuth.apiUrl;
export const adminApiClient = workspaceAuth.apiClient;
export const adminRequest = workspaceAuth.request;
