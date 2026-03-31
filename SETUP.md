# The Nest - Supabase Integration Setup Guide

This guide will help you set up the Supabase backend for The Nest gallery website.

## Prerequisites

- A Supabase account (free tier works fine)
- A Supabase project created

## Step 1: Configure Supabase

### 1.1 Create a new Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Fill in your project details
4. Wait for the project to be created (takes ~2 minutes)

### 1.2 Get your API credentials

1. In your Supabase project dashboard, go to **Settings** > **API**
2. Copy the following values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (e.g., `eyJhbG...`)

### 1.3 Update the Supabase configuration

Edit `js/supabase.js` and replace the placeholder values:

```javascript
const SUPABASE_URL = 'https://your-project-id.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

### 1.4 Set up the database and storage

1. Go to **SQL Editor** in your Supabase dashboard
2. Click **New Query**
3. Copy the contents of `supabase-schema.sql`
4. Paste and click **Run** to execute

This will create:
- The `maps` table with all required columns (using `added_at` for the timestamp)
- Row Level Security (RLS) policies
- Indexes for performance
- A trigger for automatic `updated_at` timestamps
- The `map-images` storage bucket for image uploads
- Storage RLS policies for the bucket

### 1.5 Create an admin user

1. Go to **Authentication** > **Users**
2. Click **Add user**
3. Enter an email and password
4. Click **Add user**

Use these credentials to log in at `/admin.html`.

## Step 2: Update the Website

### 2.1 Test the website

1. Open `index.html` in your browser (use a local server, e.g., Live Server)
2. Navigate to the browse page
3. The maps should load from Supabase

### 2.2 Add sample data (optional)

You can add sample data through the admin panel or by running SQL:

```sql
INSERT INTO maps (name, author, width, height, price, in_stock, image_url, tags, featured)
VALUES 
  ('Angelic Hand', 'Cask1', 4, 7, 30000000, true, 'assets/maps/angel_hand-4x7.png', '{"anime", "hand"}', true);
```

## Step 3: Using the Admin Panel

1. Navigate to `admin.html`
2. Log in with your admin credentials
3. You'll see:
   - Statistics (total maps, in stock, featured, total value)
   - List of all maps with Edit and Delete buttons
   - "Add Map" button to create new entries

### Adding/Editing Maps

- **Name**: The display name of the map
- **Author**: Creator of the map
- **Width/Height**: Map dimensions in blocks
- **Price**: In-game currency price
- **Upload Image**: Click to upload an image file (stored in Supabase Storage)
- **Image URL**: Auto-filled when uploading, or enter a direct URL
- **Tags**: Comma-separated tags for searchability
- **In Stock**: Whether the map is available for purchase
- **Featured**: Whether the map appears on the homepage

### Image Upload

When adding a new map:
1. Click "Choose File" under "Upload Image"
2. Select an image from your computer
3. A preview will appear
4. The Image URL field will be auto-filled when you submit
5. Images are stored in the `map-images` Supabase Storage bucket

## File Structure

```
website/
├── index.html          # Homepage with featured maps
├── browse.html         # Full gallery with search and filters
├── cart.html           # Shopping cart page
├── admin.html          # Admin panel (protected)
├── bundles/            # Bundle sharing pages
├── css/
│   └── styles.css      # Main stylesheet
├── js/
│   ├── app.js          # Main application logic
│   ├── admin.js        # Admin panel logic
│   ├── supabase.js     # Supabase configuration
│   └── data.js         # Legacy static data (fallback)
├── assets/
│   ├── maps/           # Map images
│   └── site_art/       # Site branding
├── supabase-schema.sql # Database schema
└── SETUP.md            # This file
```

## Security Notes

### Row Level Security (RLS)

The database is secured with RLS policies:

| Operation | Access |
|-----------|--------|
| SELECT (Read) | Anyone (public) |
| INSERT (Create) | Authenticated users only |
| UPDATE (Edit) | Authenticated users only |
| DELETE (Remove) | Authenticated users only |

### Storage RLS

The `map-images` storage bucket has these policies:
- Anyone can view images (SELECT)
- Authenticated users can upload (INSERT)
- Authenticated users can delete (DELETE)

### API Keys

- The `anon` key is safe to expose in frontend code
- It is restricted by RLS policies
- Never expose the `service_role` key

## Troubleshooting

### Maps not loading

1. Check browser console for errors
2. Verify Supabase URL and key in `js/supabase.js`
3. Ensure the `maps` table exists in Supabase

### Admin login fails

1. Verify the user exists in Supabase Authentication
2. Check that email confirmation is disabled (or confirm the email)
3. Ensure RLS policies are correctly set up

### Image upload fails

1. Ensure the `map-images` storage bucket exists
2. Check that storage RLS policies are set up
3. Verify the file is an image (png, jpg, etc.)

### CORS errors

If you see CORS errors, make sure:
1. Your Supabase project is not paused
2. You're using the correct Project URL

## Database Schema

The `maps` table has these columns:
- `id` (UUID, primary key)
- `name` (text)
- `author` (text)
- `width` (integer)
- `height` (integer)
- `price` (integer)
- `in_stock` (boolean)
- `image_url` (text)
- `tags` (text array)
- `featured` (boolean)
- `added_at` (timestamp) - when the map was added
- `updated_at` (timestamp) - when the map was last updated

## Support

For issues with:
- **Supabase**: Check [Supabase documentation](https://supabase.com/docs)
- **This website**: Check browser console for errors