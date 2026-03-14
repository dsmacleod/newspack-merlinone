<?php
/**
 * Download MerlinOne assets into the WP media library.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Merlinone_Sideloader {

	private $api;

	public function __construct( Merlinone_API $api = null ) {
		$this->api = $api ?: new Merlinone_API();
	}

	/**
	 * Import a MerlinOne asset into the WP media library.
	 *
	 * @param string $cimageid The MerlinOne asset ID.
	 * @return int|WP_Error Attachment ID on success.
	 */
	public function import( $cimageid ) {
		// Dedup check.
		$existing = $this->find_existing( $cimageid );
		if ( $existing ) {
			return $existing;
		}

		// Get metadata.
		$meta = $this->api->get_metadata( $cimageid );
		if ( is_wp_error( $meta ) ) {
			return $meta;
		}

		// Download image binary.
		$binary = $this->api->download_asset( $cimageid );
		if ( is_wp_error( $binary ) ) {
			return $binary;
		}

		// Write to temp file for sideloading.
		$filename = $this->get_field( $meta, 'COBJECT205' ) ?: ( 'merlinone-' . $cimageid . '.jpg' );
		if ( ! preg_match( '/\.\w+$/', $filename ) ) {
			$filename .= '.jpg';
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';

		$tmp = wp_tempnam( $filename );
		file_put_contents( $tmp, $binary ); // phpcs:ignore WordPress.WP.AlternativeFunctions

		$file_array = array(
			'name'     => sanitize_file_name( $filename ),
			'tmp_name' => $tmp,
		);

		$attachment_id = media_handle_sideload( $file_array, 0 );

		if ( is_wp_error( $attachment_id ) ) {
			@unlink( $tmp );
			return $attachment_id;
		}

		// Map metadata.
		$this->map_metadata( $attachment_id, $meta, $cimageid );

		// Record usage.
		$url = wp_get_attachment_url( $attachment_id );
		if ( $url ) {
			$this->api->record_usage( $cimageid, $url );
		}

		return $attachment_id;
	}

	/**
	 * Check if asset was already imported.
	 */
	private function find_existing( $cimageid ) {
		$query = new WP_Query( array(
			'post_type'      => 'attachment',
			'post_status'    => 'any',
			'meta_key'       => '_merlinone_cimageid',
			'meta_value'     => $cimageid,
			'posts_per_page' => 1,
			'fields'         => 'ids',
		) );

		return $query->have_posts() ? $query->posts[0] : null;
	}

	/**
	 * Map MerlinOne metadata to WP attachment fields.
	 */
	private function map_metadata( $attachment_id, $meta, $cimageid ) {
		$title   = $this->get_field( $meta, 'COBJECT205' );
		$caption = $this->get_field( $meta, 'CAPT2120' );

		$update = array( 'ID' => $attachment_id );
		if ( $title ) {
			$update['post_title'] = sanitize_text_field( $title );
		}
		if ( $caption ) {
			$update['post_excerpt'] = sanitize_textarea_field( $caption );
		}
		if ( count( $update ) > 1 ) {
			wp_update_post( $update );
		}

		update_post_meta( $attachment_id, '_merlinone_cimageid', sanitize_text_field( $cimageid ) );

		$byline = $this->get_field( $meta, 'CBYLINE280' );
		if ( $byline ) {
			update_post_meta( $attachment_id, '_merlinone_byline', sanitize_text_field( $byline ) );
		}

		$credit = $this->get_field( $meta, 'CREDIT2110' );
		if ( $credit ) {
			update_post_meta( $attachment_id, '_image_credit', sanitize_text_field( $credit ) );
		}

		$created = $this->get_field( $meta, 'DATECR255' );
		if ( $created ) {
			update_post_meta( $attachment_id, '_merlinone_created', sanitize_text_field( $created ) );
		}

		$keywords = $this->get_field( $meta, 'CKEYWORDS' );
		if ( $keywords ) {
			$tags = is_array( $keywords ) ? $keywords : array_map( 'trim', explode( ',', $keywords ) );
			wp_set_object_terms( $attachment_id, $tags, 'post_tag', true );
		}
	}

	/**
	 * Extract a field value from metadata response.
	 */
	private function get_field( $meta, $field_code ) {
		// Check exact case first, then lowercase (API returns lowercase keys).
		if ( isset( $meta[ $field_code ] ) ) {
			return $meta[ $field_code ];
		}
		$lower = strtolower( $field_code );
		if ( isset( $meta[ $lower ] ) ) {
			return $meta[ $lower ];
		}
		return null;
	}
}
