# Newspack MerlinOne DAM Integration

WordPress plugin that integrates MerlinOne digital asset management into the block editor. Built for the Bangor Daily News newsroom.

## Features

- **Keyword search** — Search MerlinOne assets by keyword directly from the block editor sidebar
- **Merlin ID lookup** — Paste one or more Merlin IDs (space-separated, one per line, or even as a single string of 8-digit IDs) to pull up specific images
- **Thumbnail previews** — Cached preview thumbnails load in the sidebar (24-hour cache)
- **Insert at cursor** — "Insert Image" places the image block at your current cursor position in the post
- **Set featured image** — "Featured" button sets the image as the post's featured image
- **Media library import** — Images are sideloaded into WordPress at 2400px resolution with full metadata (title, caption, byline, credit, keywords)
- **Deduplication** — Re-importing the same Merlin ID reuses the existing attachment
- **Usage tracking** — Records asset usage back to MerlinOne

## Requirements

- WordPress 6.0+
- PHP 7.4+
- MerlinOne mXchange API access

## Configuration

Add these constants to `wp-config.php`:

```php
define( 'MERLINONE_URL', 'https://your-instance.merlinone.net' );
define( 'MERLINONE_USERNAME', 'your-username' );
define( 'MERLINONE_PASSWORD', 'your-password' );
```

Or configure via the Settings > MerlinOne page in wp-admin.

## Usage

1. Open any post in the block editor
2. Click the wizard hat icon in the top-right toolbar to open the MerlinOne sidebar
3. **Search by keyword**: Type a search term and click Search
4. **Look up by ID**: Paste Merlin IDs into the textarea and click "Look Up IDs"
5. Click "Insert Image" to add at cursor position, or "Featured" to set as featured image

## Authors

Dan MacLeod with Claude Code
