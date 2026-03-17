<?php
/**
 * MerlinOne mXchange API client.
 *
 * All mXchange endpoints use application/x-www-form-urlencoded.
 * Search is two-step: POST /search returns {id, count}, then
 * POST /search/{id} with hit.from/hit.to/asset.fields returns assets.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Merlinone_API {

	private $base_url;
	private $username;
	private $password;
	private $cookies = array();
	private $transient_key = 'merlinone_session';

	public function __construct() {
		$this->base_url = untrailingslashit( newspack_merlinone_get_config( 'url' ) );
		$this->username = newspack_merlinone_get_config( 'username' );
		$this->password = newspack_merlinone_get_config( 'password' );
		$this->cookies  = get_transient( $this->transient_key ) ?: array();
	}

	/**
	 * Authenticate and cache session cookies.
	 */
	public function login() {
		$response = wp_remote_post( $this->base_url . '/login', array(
			'body'    => array(
				'UserName' => $this->username,
				'Password' => $this->password,
			),
			'timeout' => 30,
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( $code >= 400 ) {
			return new WP_Error( 'merlinone_login_failed', 'Login failed with status ' . $code );
		}

		// Check for errMessage in response.
		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( ! empty( $body['errMessage'] ) ) {
			return new WP_Error( 'merlinone_login_failed', $body['errMessage'] );
		}

		$this->cookies = wp_remote_retrieve_cookies( $response );
		set_transient( $this->transient_key, $this->cookies, 20 * MINUTE_IN_SECONDS );

		return true;
	}

	/**
	 * Search for assets. Two-step: create search, then fetch hits.
	 */
	public function search( $term, $options = array() ) {
		$defaults = array(
			'type'   => 'IMAGES',
			'from'   => 0,
			'size'   => 10,
			'fields' => array( 'cobject205', 'capt2120', 'cbyline280', 'credit2110', 'ckeywords', 'datecr255', 'cimageid', 'thumb512', 'thumbweb' ),
		);
		$opts = wp_parse_args( $options, $defaults );

		// Step 1: Create the search, sorted by ingest date (newest first).
		$search_body = array(
			'search.term'       => $term,
			'search.sort.field' => 'INDATE',
			'search.sort.order' => 'DESCENDING',
		);
		if ( ! empty( $opts['type'] ) ) {
			$search_body['search.asset.type'] = $opts['type'];
		}

		$search_result = $this->request( 'POST', '/mXchange/v1/search', $search_body );
		if ( is_wp_error( $search_result ) ) {
			return $search_result;
		}

		$search_id = isset( $search_result['id'] ) ? $search_result['id'] : null;
		$count     = isset( $search_result['count'] ) ? (int) $search_result['count'] : 0;

		if ( ! $search_id || $count === 0 ) {
			return array(
				'assets' => array(),
				'total'  => 0,
			);
		}

		// Step 2: Fetch hits.
		$hit_to = min( $opts['from'] + $opts['size'] - 1, $count - 1 );
		$fetch_body = array(
			'hit.from'     => $opts['from'],
			'hit.to'       => $hit_to,
			'asset.fields' => wp_json_encode( $opts['fields'] ),
		);

		$hits_result = $this->request( 'POST', '/mXchange/v1/search/' . $search_id, $fetch_body );
		if ( is_wp_error( $hits_result ) ) {
			return $hits_result;
		}

		$assets = isset( $hits_result['assets'] ) ? $hits_result['assets'] : array();

		return array(
			'assets'    => $assets,
			'total'     => $count,
			'search_id' => $search_id,
		);
	}

	/**
	 * Get asset metadata.
	 */
	public function get_metadata( $cimageid ) {
		return $this->request( 'GET', '/mXchange/v1/asset/' . $cimageid . '/metadata' );
	}

	/**
	 * Download an asset binary.
	 */
	public function download_asset( $cimageid, $transform = array() ) {
		$defaults = array(
			'image.format' => 'jpg',
			'image.pixels' => '1200',
		);
		$transform = wp_parse_args( $transform, $defaults );

		return $this->request( 'POST', '/mXchange/v1/asset/' . $cimageid . '/object', $transform, true );
	}

	/**
	 * Get a temporary URL for preview/thumbnail.
	 */
	public function get_temp_url( $cimageid, $transform = array() ) {
		$defaults = array(
			'image.format' => 'jpg',
			'image.pixels' => '400',
		);
		$transform = wp_parse_args( $transform, $defaults );

		return $this->request( 'POST', '/mXchange/v1/asset/' . $cimageid . '/url', $transform );
	}

	/**
	 * Record usage of an asset.
	 */
	public function record_usage( $cimageid, $url ) {
		return $this->request( 'POST', '/mXchange/v1/asset/' . $cimageid . '/usage/create', array(
			'url' => $url,
		) );
	}

	/**
	 * Make an authenticated API request with auto-retry on session expiry.
	 * All requests use form-encoded body (not JSON).
	 */
	private function request( $method, $endpoint, $body = null, $raw = false, $retried = false ) {
		if ( empty( $this->cookies ) ) {
			$login = $this->login();
			if ( is_wp_error( $login ) ) {
				return $login;
			}
		}

		$args = array(
			'method'  => $method,
			'cookies' => $this->cookies,
			'timeout' => 60,
		);

		// Form-encoded body (wp_remote_request sends arrays as form-encoded by default).
		if ( $body ) {
			$args['body'] = $body;
		}

		$response = wp_remote_request( $this->base_url . $endpoint, $args );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );

		// Re-login once on auth failure.
		if ( in_array( $code, array( 401, 403 ), true ) && ! $retried ) {
			delete_transient( $this->transient_key );
			$this->cookies = array();
			$login = $this->login();
			if ( is_wp_error( $login ) ) {
				return $login;
			}
			return $this->request( $method, $endpoint, $body, $raw, true );
		}

		if ( $code >= 400 ) {
			return new WP_Error( 'merlinone_api_error', 'API error: ' . $code, array(
				'status' => $code,
				'body'   => wp_remote_retrieve_body( $response ),
			) );
		}

		if ( $raw ) {
			return wp_remote_retrieve_body( $response );
		}

		return json_decode( wp_remote_retrieve_body( $response ), true );
	}
}
