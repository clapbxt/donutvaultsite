-- ============================================
-- The Nest - Supabase Database Schema
-- ============================================
-- This file contains the SQL to set up the maps table
-- and Row Level Security (RLS) policies for The Nest
-- Minecraft map art gallery.
-- ============================================

-- ============================================
-- 1. CREATE TABLES
-- ============================================

-- Maps table: stores all gallery map data
CREATE TABLE IF NOT EXISTS public.maps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    author TEXT NOT NULL,
    width INTEGER NOT NULL CHECK (width > 0),
    height INTEGER NOT NULL CHECK (height > 0),
    price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
    in_stock BOOLEAN NOT NULL DEFAULT true,
    image_url TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    featured BOOLEAN NOT NULL DEFAULT false,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add index for common queries
CREATE INDEX IF NOT EXISTS idx_maps_featured ON public.maps(featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_maps_in_stock ON public.maps(in_stock) WHERE in_stock = true;
CREATE INDEX IF NOT EXISTS idx_maps_added_at ON public.maps(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_maps_author ON public.maps(author);

-- ============================================
-- 2. ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.maps ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. CREATE RLS POLICIES
-- ============================================

-- Policy: Anyone can SELECT (read) maps
-- This allows the public gallery to work without authentication
CREATE POLICY "Anyone can view maps"
    ON public.maps
    FOR SELECT
    TO public
    USING (true);

-- Policy: Only authenticated users can INSERT new maps
-- This protects against unauthorized additions
CREATE POLICY "Authenticated users can insert maps"
    ON public.maps
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy: Only authenticated users can UPDATE maps
-- This protects against unauthorized modifications
CREATE POLICY "Authenticated users can update maps"
    ON public.maps
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policy: Only authenticated users can DELETE maps
-- This protects against unauthorized deletions
CREATE POLICY "Authenticated users can delete maps"
    ON public.maps
    FOR DELETE
    TO authenticated
    USING (true);

-- ============================================
-- 4. CREATE UPDATED_AT TRIGGER
-- ============================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at on every UPDATE
CREATE TRIGGER update_maps_updated_at
    BEFORE UPDATE ON public.maps
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 5. CREATE STORAGE BUCKET FOR MAP IMAGES
-- ============================================

-- Create the storage bucket for map images
-- Run this in a separate query if the bucket doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('map-images', 'map-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies for map-images bucket
-- Anyone can view map images
CREATE POLICY "Anyone can view map images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'map-images');

-- Only authenticated users can upload map images
CREATE POLICY "Authenticated users can upload map images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'map-images');

-- Only authenticated users can delete map images
CREATE POLICY "Authenticated users can delete map images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'map-images');

-- ============================================
-- 6. SUPABASE AUTH SETUP (One-time)
-- ============================================

-- To create an admin user in Supabase:
-- 1. Go to your Supabase project dashboard
-- 2. Navigate to Authentication > Users
-- 3. Click "Add user" and create an account with email/password
-- 4. Use those credentials to log in at /admin.html

-- Alternatively, you can use the Supabase CLI:
-- npx supabase auth users create admin@example.com --password yourpassword

-- ============================================
-- END OF SCHEMA
-- ============================================