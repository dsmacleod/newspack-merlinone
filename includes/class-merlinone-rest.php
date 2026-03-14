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
				'type'  => array(
					'type'              => 'string',
					'default'           => 'Image',
					'sanitize_callback' => 'sanitize_text_field',
				),
				'from'  => array(
					'type'    => 'integer',
					'default' => 0,
				),
				'size'  => array(
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

		register_rest_route( $namespace, '/thumbnail', array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'thumbnail' ),
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
					'required' => true,
					'type'     => 'string',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		) );

		register_rest_route( $namespace, '/status', array(
			'methods'             => 'GET',
			'callback'            => array( $this, 'status' ),
			'permission_callback' => array( $this, 'check_permission' ),
		) );
	}

	public function check_permission() {
		return current_user_can( 'edit_posts' );
	}

	public function search( WP_REST_Request $request ) {
		$api  = new Merlinone_API();
		$type = $request['type'];
		// Map friendly names to API values.
		$type_map = array( 'Image' => 'IMAGES', 'Graphic' => 'IMAGES', '' => '' );
		$api_type = isset( $type_map[ $type ] ) ? $type_map[ $type ] : $type;

		$result = $api->search( $request['query'], array(
			'type' => $api_type,
			'from' => $request['from'],
			'size' => $request['size'],
		) );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$assets = isset( $result['assets'] ) ? $result['assets'] : array();

		return rest_ensure_response( array(
			'assets' => $assets,
			'total'  => isset( $result['total'] ) ? (int) $result['total'] : count( $assets ),
		) );
	}

	public function import_asset( WP_REST_Request $request ) {
		$sideloader    = new Merlinone_Sideloader();
		$attachment_id = $sideloader->import( $request['cimageid'] );

		if ( is_wp_error( $attachment_id ) ) {
			return $attachment_id;
		}

		return rest_ensure_response( array(
			'attachment_id' => $attachment_id,
			'url'           => wp_get_attachment_url( $attachment_id ),
			'edit_link'     => get_edit_post_link( $attachment_id, 'raw' ),
		) );
	}

	public function lookup( WP_REST_Request $request ) {
		$api = new Merlinone_API();
		// Parse IDs: split on commas/spaces/newlines, or split a long digit string into 8-digit chunks.
		$input = trim( $request['ids'] );
		// If it's all digits with no separators, chunk into 8-digit IDs.
		if ( preg_match( '/^\d{16,}$/', $input ) ) {
			$raw_ids = str_split( $input, 8 );
		} else {
			$raw_ids = preg_split( '/[\s,]+/', $input );
		}
		$ids = array_filter( array_map( 'trim', $raw_ids ), 'strlen' );

		if ( empty( $ids ) ) {
			return new WP_Error( 'no_ids', 'No valid IDs provided.', array( 'status' => 400 ) );
		}

		// Cap at 20 to avoid timeouts.
		$ids    = array_slice( $ids, 0, 20 );
		$assets = array();

		foreach ( $ids as $cimageid ) {
			$assets[] = array(
				'CIMAGEID'      => $cimageid,
				'COBJECT205'    => 'ID: ' . $cimageid,
				'thumbnail_url' => '',
			);
		}

		return rest_ensure_response( array(
			'assets' => $assets,
			'total'  => count( $assets ),
		) );
	}

	public function thumbnail( WP_REST_Request $request ) {
		$cimageid = $request['cimageid'];

		// Check cache first (24-hour TTL).
		$cache_key = 'merlin_thumb_' . $cimageid;
		$cached    = get_transient( $cache_key );
		if ( $cached ) {
			return rest_ensure_response( array( 'url' => $cached ) );
		}

		$api        = new Merlinone_API();
		$url_result = $api->get_temp_url( $cimageid, array( 'image.format' => 'jpg', 'image.pixels' => '200' ) );

		if ( is_wp_error( $url_result ) ) {
			return $url_result;
		}

		$url = is_string( $url_result ) ? $url_result : ( isset( $url_result['url'] ) ? $url_result['url'] : '' );

		if ( $url ) {
			set_transient( $cache_key, $url, DAY_IN_SECONDS );
		}

		return rest_ensure_response( array( 'url' => $url ) );
	}

	public function status( WP_REST_Request $request ) {
		$step = 'init';
		try {
			$url = newspack_merlinone_get_config( 'url' );
			$step = 'config_loaded';

			if ( empty( $url ) ) {
				return rest_ensure_response( array(
					'connected' => false,
					'error'     => 'MERLINONE_URL is not configured.',
					'step'      => $step,
				) );
			}

			$step = 'creating_api';
			$api  = new Merlinone_API();

			$step  = 'logging_in';
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
}

new Merlinone_REST();
