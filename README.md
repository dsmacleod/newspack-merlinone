# Newspack MerlinOne DAM Integration

**In plain terms:** lets BDN editors pull photos from the newsroom's MerlinOne photo archive into a WordPress post without leaving the editor — search by keyword, paste IDs, or have photos attach automatically when a reporter writes `MERLIN ID: 12345` in a Google Docs comment.

## Inputs / Outputs

**Inputs**
- MerlinOne mXchange API credentials (URL, username, password)
- A search keyword, a list of Merlin IDs typed by an editor, **or** `_bdn_merlin_pending` postmeta written by the bdn-metadata Doc_Receiver
- The `bdn_doc_imported` action firing for posts that came in via the Send-to-WordPress Docs add-on

**Outputs**
- WordPress media library attachments (sideloaded at 1200px wide, with caption/byline/credit metadata)
- Image blocks inserted into the post body, optionally at specific paragraph positions
- A featured image, when a `MERLIN ID: <id> lede` comment is present
- A loud placeholder paragraph when an editor submits multiple IDs in one comment

## How an editor uses it

Two paths:

### 1. From a Google Doc comment (the desk's default path)

In the Google Doc, leave comments shaped like:

| Comment | Result |
|---|---|
| `MERLIN ID: 12345` | Photo inserted at the paragraph the comment was anchored to |
| `MERLIN ID: 12345 lede` | That photo becomes the featured image (not inserted inline) |
| `MERLIN ID: 123, 456, 789` | Placeholder block in WP: "3 photo candidates — pick one or make a gallery" |

When the editor hits "Send to WordPress" in Docs, the bdn-metadata receiver writes the parsed directives to `_bdn_merlin_pending` postmeta and fires the `bdn_doc_imported` action. This plugin listens at priority 20, sideloads each photo, and inserts the blocks. Zero clicks in WP.

### 2. From the block editor (manual)

1. Open any post and click the wizard hat icon in the top-right toolbar
2. Search by keyword, or paste one or more Merlin IDs
3. Click **"Insert Image"** or **"Featured"** on any result
4. A review panel appears with the full preview, metadata, and editable caption/credit fields
5. Click **"Insert Image"** or **"Set as Featured Image"** to place it

Captions are inserted in the format `Caption text (Credit)`. For featured images, caption and credit are saved to the attachment metadata so the Newspack theme displays them automatically.

## Features

- **Auto-attach from Docs comments** — Photos referenced in `MERLIN ID:` doc comments land in the post automatically (no clicking in WP)
- **Keyword search** — Search MerlinOne assets by keyword directly from the block editor sidebar
- **Merlin ID lookup** — Paste one or more Merlin IDs (space-separated, one per line, or as a single string of 8-digit IDs) to pull up specific images
- **Batch thumbnails** — Preview thumbnails load in a single request with 24-hour caching
- **Edit before insert** — Review and edit caption and credit before placing the image
- **Insert at cursor / anchor** — Place the image block at your current cursor position, or at the paragraph a Doc comment was anchored to
- **Set featured image** — Set the image as the post's featured image with caption/credit
- **Media library import** — Images are sideloaded into WordPress at 1200px wide with full metadata (title, caption, byline, credit, keywords)
- **Deduplication** — Re-importing the same Merlin ID reuses the existing attachment
- **Usage tracking** — Records asset usage back to MerlinOne

## Requirements

- WordPress 6.0+
- PHP 7.4+
- MerlinOne mXchange API access
- Optional: [bdn-metadata](https://gitlab.bangordailynews.com/newsroom/bdn-metadata) plugin for the auto-attach-from-Docs path

## Configuration

Add these constants to `wp-config.php`:

```php
define( 'MERLINONE_URL', 'https://your-instance.merlinone.net' );
define( 'MERLINONE_USERNAME', 'your-username' );
define( 'MERLINONE_PASSWORD', 'your-password' );
```

Or configure via the **Settings → MerlinOne** page in wp-admin.

## How the auto-attach handler works

The `Merlinone_Auto_Attach` class hooks `bdn_doc_imported` at priority 20 (after bdn-metadata's Airtable enrichment at priority 10). For each entry in `_bdn_merlin_pending`:

- **Single ID with `lede` flag** → sideload, set as featured image (first one wins if multiple lede comments exist)
- **Single ID without `lede`** → sideload, insert `core/image` block at the paragraph index recorded in `_bdn_comment_anchors`
- **Multiple IDs** → insert a paragraph block with class `bdn-merlin-pending` saying "N photo candidates pending — IDs X, Y, Z. Pick one or make a gallery." No sideload (the editor decides what to do)
- **Sideload failure** → insert a paragraph block with class `bdn-merlin-error` naming the failing ID

After processing, `_bdn_merlin_pending` is deleted so the handler can't re-run on the same post.

## File Structure

```
newspack-merlinone.php                — Plugin bootstrap, config helper, editor asset enqueue
includes/
  class-merlinone-api.php             — mXchange REST API client (auth, search, download, thumbnails)
  class-merlinone-auto-attach.php     — Hooks bdn_doc_imported; sideloads + inserts from Doc comments
  class-merlinone-rest.php            — WP REST endpoints (search, import, thumbnails, lookup, update-meta)
  class-merlinone-settings.php        — Admin settings page
  class-merlinone-sideloader.php      — Downloads and sideloads images into the WP media library
  class-merlinone-sync.php            — Background cron sync of newest Merlin photos
assets/
  js/merlinone-media-modal.js         — Block editor sidebar UI (React via wp.element)
  css/merlinone-admin.css             — Admin styles
```

## Related plugins

- **[bdn-metadata](https://gitlab.bangordailynews.com/newsroom/bdn-metadata)** — provides the Doc_Receiver REST endpoint and `bdn_doc_imported` action that this plugin's auto-attach handler hooks

## Authors

Dan MacLeod with Claude Code
