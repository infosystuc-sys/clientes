import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCredentials } from '../types/database';

const STORAGE_KEY_URL = 'supabase_url_config';
const STORAGE_KEY_KEY = 'supabase_anon_key_config';

export function getSupabaseCredentials(): SupabaseCredentials {
  const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const localUrl = localStorage.getItem(STORAGE_KEY_URL) || '';
  const localKey = localStorage.getItem(STORAGE_KEY_KEY) || '';

  const url = localUrl || envUrl;
  const anonKey = localKey || envKey;

  const isConfigured = Boolean(
    url && 
    anonKey && 
    url.startsWith('https://') && 
    url.includes('.supabase.co') &&
    anonKey.length > 20
  );

  return { url, anonKey, isConfigured };
}

export function saveSupabaseCredentials(url: string, anonKey: string): void {
  if (url) localStorage.setItem(STORAGE_KEY_URL, url.trim());
  else localStorage.removeItem(STORAGE_KEY_URL);

  if (anonKey) localStorage.setItem(STORAGE_KEY_KEY, anonKey.trim());
  else localStorage.removeItem(STORAGE_KEY_KEY);

  // Refresh client
  initSupabaseClient();
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  
  if (!isConfigured) return null;

  if (!supabaseInstance) {
    try {
      supabaseInstance = createClient(url, anonKey);
    } catch (e) {
      console.error('Error inicializando el cliente de Supabase:', e);
      return null;
    }
  }
  return supabaseInstance;
}

export function initSupabaseClient(): SupabaseClient | null {
  supabaseInstance = null;
  return getSupabaseClient();
}
