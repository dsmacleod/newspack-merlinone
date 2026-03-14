<?php
/**
 * Plugin Name: Newspack MerlinOne DAM Integration
 * Description: Pull images from MerlinOne DAM into the WordPress media library via mXchange REST API.
 * Version: 1.0.0
 * Author: Dan MacLeod with Claude Code
 * Text Domain: newspack-merlinone
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'NEWSPACK_MERLINONE_VERSION', '1.0.0' );
define( 'NEWSPACK_MERLINONE_DIR', plugin_dir_path( __FILE__ ) );
define( 'NEWSPACK_MERLINONE_URL', plugin_dir_url( __FILE__ ) );

require_once NEWSPACK_MERLINONE_DIR . 'includes/class-merlinone-api.php';
require_once NEWSPACK_MERLINONE_DIR . 'includes/class-merlinone-sideloader.php';
require_once NEWSPACK_MERLINONE_DIR . 'includes/class-merlinone-settings.php';
require_once NEWSPACK_MERLINONE_DIR . 'includes/class-merlinone-rest.php';

/**
 * Get a plugin configuration value, checking wp-config constants first, then options.
 */
function newspack_merlinone_get_config( $key ) {
	$constant = 'MERLINONE_' . strtoupper( $key );
	if ( defined( $constant ) ) {
		return constant( $constant );
	}
	return get_option( 'newspack_merlinone_' . $key, '' );
}

add_action( 'enqueue_block_editor_assets', function() {
	wp_enqueue_script(
		'newspack-merlinone-modal',
		NEWSPACK_MERLINONE_URL . 'assets/js/merlinone-media-modal.js',
		array( 'wp-plugins', 'wp-edit-post', 'wp-components', 'wp-element', 'wp-data', 'wp-blocks', 'wp-compose', 'wp-api-fetch' ),
		NEWSPACK_MERLINONE_VERSION,
		true
	);
	wp_enqueue_style(
		'newspack-merlinone-admin',
		NEWSPACK_MERLINONE_URL . 'assets/css/merlinone-admin.css',
		array(),
		NEWSPACK_MERLINONE_VERSION
	);
});
