<?php
/**
 * REST API endpoints for the MerlinOne block editor panel.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Merlinone_REST {

	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes() {
		$namespace = 'newspack-merlinone/v1';

		register_rest_route( $namespace, '/search', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'search' ),
			'permission_callback' => array( $this, 'check_permission' ),
			'args'                => array(
				'query' => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				),
				'page'  => array(
					'type'    => 'integer',
					'default' => 1,
				),
				'per_page' => array(
					'type'    => 'integer',
					'default' => 20,
				),
			),
		) );

		register_rest_route( $namespace, '/import', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'import_asset' ),
			'permission_callback' => array( $this, 'check_permission' ),
			'args'                => array(
				'cimageid' => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( $namespace, '/lookup', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'lookup' ),
			'permission_callback' => array( $this, 'check_permission' ),
			'args'                => array(
				'ids' => array(
					'required'          => true,
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( $namespace, '/update-meta', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'update_meta' ),
			'permission_callback' => array( $this, 'check_permission' ),
			'args'                => array(
				'attachment_id' => array(
					'required' => true,
					'type'     => 'integer',
				),
				'credit' => array(
					'type'              => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( $namespace, '/status', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'status' ),
			'permission_callback' => array( $this, 'check_permission' ),
		) );

		register_rest_route( $namespace, '/sync', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'sync' ),
			'permission_callback' => array( $this, 'check_admin_permission' ),
		) );

		register_rest_route( $namespace, '/sync-status', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'sync_status' ),
			'permission_callback' => array( $this, 'check_admin_permission' ),
		) );
	}

	public function check_permission() {
		return current_user_can( 'edit_posts' );
	}

	public function check_admin_permission() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Search WP media library for MerlinOne-imported attachments.
	 */
	public function search( WP_REST_Request $request ) {
		$query    = $request['query'];
		$page     = max( 1, (int) $request['page'] );
		$per_page = min( 50, max( 1, (int) $request['per_page'] ) );

		$args = array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'posts_per_page' => $per_page,
			'paged'          => $page,
			's'              => $query,
			'meta_key'       => '_merlinone_cimageid',
			'meta_compare'   => 'EXISTS',
		);

		$wp_query = new WP_Query( $args );
		$assets   = array();

		foreach ( $wp_query->posts as $post ) {
			$assets[] = $this->format_attachment( $post );
		}

		return rest_ensure_response( array(
			'assets' => $assets,
			'total'  => (int) $wp_query->found_posts,
			'page'   => $page,
			'pages'  => (int) $wp_query->max_num_pages,
		) );
	}

	/**
	 * Import a MerlinOne asset by ID (on-demand import for ID lookup).
	 */
	public function import_asset( WP_REST_Request $request ) {
		$sideloader    = new Merlinone_Sideloader();
		$attachment_id = $sideloader->import( $request['cimageid'] );

		if ( is_wp_error( $attachment_id ) ) {
			return $attachment_id;
		}

		$post = get_post( $attachment_id );
		return rest_ensure_response( $this->format_attachment( $post ) );
	}

	/**
	 * Look up Merlin IDs — import each on demand, return WP attachment data.
	 */
	public function lookup( WP_REST_Request $request ) {
		$input = trim( $request['ids'] );
		if ( preg_match( '/^\d{16,}$/', $input ) ) {
			$raw_ids = str_split( $input, 8 );
		} else {
			$raw_ids = preg_split( '/[\s,]+/', $input );
		}
		$ids = array_filter( array_map( 'trim', $raw_ids ), 'strlen' );

		if ( empty( $ids ) ) {
			return new WP_Error( 'no_ids', 'No valid IDs provided.', array( 'status' => 400 ) );
		}

		$ids        = array_slice( $ids, 0, 20 );
		$sideloader = new Merlinone_Sideloader();
		$assets     = array();
		$errors     = array();

		foreach ( $ids as $cimageid ) {
			$attachment_id = $sideloader->import( $cimageid );
			if ( is_wp_error( $attachment_id ) ) {
				$errors[] = array( 'id' => $cimageid, 'error' => $attachment_id->get_error_message() );
			} else {
				$assets[] = $this->format_attachment( get_post( $attachment_id ) );
			}
		}

		return rest_ensure_response( array(
			'assets' => $assets,
			'errors' => $errors,
			'total'  => count( $assets ),
		) );
	}

	public function update_meta( WP_REST_Request $request ) {
		$id = (int) $request['attachment_id'];
		if ( ! get_post( $id ) ) {
			return new WP_Error( 'not_found', 'Attachment not found.', array( 'status' => 404 ) );
		}
		if ( isset( $request['credit'] ) ) {
			update_post_meta( $id, '_image_credit', sanitize_text_field( $request['credit'] ) );
		}
		return rest_ensure_response( array( 'updated' => true ) );
	}

	public function status( WP_REST_Request $request ) {
		$step = 'init';
		try {
			$url  = newspack_merlinone_get_config( 'url' );
			$step = 'config_loaded';

			if ( empty( $url ) ) {
				return rest_ensure_response( array(
					'connected' => false,
					'error'     => 'MERLINONE_URL is not configured.',
					'step'      => $step,
				) );
			}

			$step  = 'logging_in';
			$api   = new Merlinone_API();
			$login = $api->login();

			if ( is_wp_error( $login ) ) {
				return rest_ensure_response( array(
					'connected' => false,
					'error'     => $login->get_error_message(),
					'code'      => $login->get_error_code(),
					'url'       => $url . '/login',
					'step'      => $step,
				) );
			}

			return rest_ensure_response( array( 'connected' => true ) );
		} catch ( \Exception $e ) {
			return rest_ensure_response( array(
				'connected' => false,
				'error'     => $e->getMessage(),
				'step'      => $step,
			) );
		} catch ( \Error $e ) {
			return rest_ensure_response( array(
				'connected' => false,
				'error'     => $e->getMessage(),
				'step'      => $step,
			) );
		}
	}

	/**
	 * Trigger a manual sync.
	 */
	public function sync( WP_REST_Request $request ) {
		$sync   = new Merlinone_Sync();
		$result = $sync->sync_now();
		return rest_ensure_response( $result );
	}

	/**
	 * Get sync status info.
	 */
	public function sync_status( WP_REST_Request $request ) {
		$last_sync   = get_option( Merlinone_Sync::OPTION_LAST, '' );
		$last_result = get_option( Merlinone_Sync::OPTION_RESULT, array() );
		$enabled     = (bool) get_option( Merlinone_Sync::OPTION_ENABLE, false );

		// Count total MerlinOne photos in WP.
		$count_query = new WP_Query( array(
			'post_type'      => 'attachment',
			'post_status'    => 'inherit',
			'meta_key'       => '_merlinone_cimageid',
			'meta_compare'   => 'EXISTS',
			'posts_per_page' => 1,
			'fields'         => 'ids',
		) );

		return rest_ensure_response( array(
			'enabled'     => $enabled,
			'last_sync'   => $last_sync,
			'last_result' => $last_result,
			'total_photos' => (int) $count_query->found_posts,
			'next_scheduled' => wp_next_scheduled( Merlinone_Sync::CRON_HOOK ) ?: null,
		) );
	}

	/**
	 * Format a WP attachment post into the standard response shape.
	 */
	private function format_attachment( $post ) {
		$id            = $post->ID;
		$thumbnail_url = '';
		$sizes         = wp_get_attachment_image_src( $id, 'thumbnail' );
		if ( $sizes ) {
			$thumbnail_url = $sizes[0];
		}

		return array(
			'attachment_id' => $id,
			'title'         => $post->post_title,
			'caption'       => $post->post_excerpt,
			'credit'        => get_post_meta( $id, '_image_credit', true ),
			'byline'        => get_post_meta( $id, '_merlinone_byline', true ),
			'date'          => $post->post_date,
			'cimageid'      => get_post_meta( $id, '_merlinone_cimageid', true ),
			'thumbnail_url' => $thumbnail_url,
			'url'           => wp_get_attachment_url( $id ),
		);
	}
}

new Merlinone_REST();
