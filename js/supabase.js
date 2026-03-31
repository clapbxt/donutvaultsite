/**
 * Supabase Client Configuration
 * 
 * This file initializes the Supabase client for connecting to the backend.
 * Replace the placeholder values with your actual Supabase project credentials.
 * 
 * To get your credentials:
 * 1. Go to your Supabase project dashboard
 * 2. Navigate to Settings > API
 * 3. Copy the Project URL and anon/public key
 */

// IMPORTANT: Replace these with your actual Supabase project credentials
const SUPABASE_URL = 'https://kebsazlayhsobgwvgkpx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_c9c6CPzQkwuMMOs0jlkQug_THvwbkva';

// Initialize Supabase client (loaded via CDN)
let supabaseClient = null;

/**
 * Get the Supabase client instance
 * Creates the client on first call if it doesn't exist
 */
function getSupabaseClient() {
    if (!supabaseClient) {
        if (typeof supabase === 'undefined') {
            console.error('Supabase client library not loaded. Make sure to include the CDN script.');
            return null;
        }
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

/**
 * Check if Supabase is properly configured
 */
function isSupabaseConfigured() {
    return SUPABASE_URL !== 'https://your-project-id.supabase.co' && 
           SUPABASE_ANON_KEY !== 'your-anon-key-here';
}

// Export for use in other modules
window.SupabaseConfig = {
    getClient: getSupabaseClient,
    isConfigured: isSupabaseConfigured,
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY
};