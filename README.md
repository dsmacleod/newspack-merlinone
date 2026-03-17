# Newspack MerlinOne DAM Integration

WordPress plugin that integrates MerlinOne digital asset management into the block editor. Built for the Bangor Daily News newsroom.

## Features

- **Keyword search** — Search MerlinOne assets by keyword directly from the block editor sidebar
- **Merlin ID lookup** — Paste one or more Merlin IDs (space-separated, one per line, or even as a single string of 8-digit IDs) to pull up specific images
- **Batch thumbnails** — Preview thumbnails load in a single request with 24-hour caching
- **Edit before insert** — Review and edit caption and credit before placing the image
- **Insert at cursor** — Place the image block at your current cursor position in the post
- **Set featured image** — Set the image as the post's featured image with caption/credit
- **Media library import** — Images are sideloaded into WordPress at 1200px wide with full metadata (title, caption, byline, credit, keywords)
- **Deduplication** — Re-importing the same Merlin ID reuses the existing attachment
- **Usage tracking** — Records asset usage back to MerlinOne

## Workflow

1. Open any post in the block editor
2. Click the wizard hat icon in the top-right toolbar to open the **MerlinOne sidebar**
3. Search by keyword or paste Merlin IDs to find images
4. Click **"Insert Image"** or **"Featured"** on any result
5. The image imports from MerlinOne and a **review panel** appears showing:
   - Full preview at imported resolution
   - Metadata (Merlin ID, title, byline)
   - **Editable caption** and **editable credit** fields
6. Edit the caption and credit as needed
7. Click **"Insert Image"** or **"Set as Featured Image"** to place it, or **"Cancel"** to go back to results

Captions are inserted in the format: `Caption text (Credit)`. For featured images, the caption and credit are saved to the attachment metadata so the Newspack theme displays them automatically.

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

## File Structure

```
newspack-merlinone.php              — Plugin bootstrap, config helper, editor asset enqueue
includes/
  class-merlinone-api.php           — mXchange REST API client (auth, search, download, thumbnails)
  class-merlinone-rest.php          — WP REST endpoints (search, import, thumbnails, lookup, update-meta)
  class-merlinone-sideloader.php    — Downloads and sideloads images into the WP media library
  class-merlinone-settings.php      — Admin settings page
assets/
  js/merlinone-media-modal.js       — Block editor sidebar UI (React via wp.element)
  css/merlinone-admin.css           — Admin styles
```

## Authors

Dan MacLeod with Claude Code
