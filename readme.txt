=== Newspack MerlinOne DAM Integration ===
Contributors: bdndigital
Tags: merlinone, dam, media, newspack
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0

Pull images from MerlinOne DAM into the WordPress media library via the mXchange REST API.

== Description ==

Integrates MerlinOne digital asset management with WordPress/Newspack. Search and import images directly from the block editor sidebar panel.

Features:

* Search MerlinOne assets from the block editor
* Import images to the WP media library with proper srcset generation
* Automatic metadata mapping (caption, byline, credit, keywords)
* Deduplication — won't re-import assets already in the library
* Usage recording back to MerlinOne
* Set as featured image or insert as image block

== Configuration ==

Add to wp-config.php (recommended):

    define( 'MERLINONE_URL', 'https://your-instance.merlinone.net' );
    define( 'MERLINONE_USERNAME', 'your-username' );
    define( 'MERLINONE_PASSWORD', 'your-password' );

Or configure via Settings → MerlinOne DAM.

== Changelog ==

= 1.0.0 =
* Initial release
