<?php
/**
 * Background sync: imports MerlinOne photos into the WP media library on a schedule.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Merlinone_Sync {

	const CRON_HOOK     = 'newspack_merlinone_sync';
	const INTERVAL_NAME = 'merlinone_15min';
	const OPTION_ENABLE = 'newspack_merlinone_enable_sync';
	const OPTION_LAST   = 'newspack_merlinone_last_sync';
	const OPTION_RESULT = 'newspack_merlinone_last_sync_result';

	public function __construct() {
		add_filter( 'cron_schedules', array( $this, 'add_interval' ) );
		add_action( self::CRON_HOOK, array( $this, 'sync_now' ) );
	}

	/**
	 * Register the 15-minute cron interval.
	 */
	public function add_interval( $schedules ) {
		$schedules[ self::INTERVAL_NAME ] = array(
			'interval' => 15 * MINUTE_IN_SECONDS,
			'display'  => 'Every 15 minutes',
		);
		return $schedules;
	}

	/**
	 * Schedule the cron event (called on plugin activation).
	 */
	public static function schedule() {
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time(), self::INTERVAL_NAME, self::CRON_HOOK );
		}
	}

	/**
	 * Unschedule the cron event (called on plugin deactivation).
	 */
	public static function unschedule() {
		$timestamp = wp_next_scheduled( self::CRON_HOOK );
		if ( $timestamp ) {
			wp_unschedule_event( $timestamp, self::CRON_HOOK );
		}
	}

	/**
	 * Run a sync: search MerlinOne for newest photos, import until we hit a duplicate.
	 *
	 * @return array Summary with 'imported' count and 'status' string.
	 */
	public function sync_now() {
		if ( ! get_option( self::OPTION_ENABLE ) ) {
			$result = array( 'imported' => 0, 'status' => 'disabled' );
			update_option( self::OPTION_RESULT, $result );
			return $result;
		}

		$api        = new Merlinone_API();
		$sideloader = new Merlinone_Sideloader( $api );
		$imported   = 0;
		$errors     = 0;
		$page_size  = 20;
		$offset     = 0;
		$max_pages  = 10; // safety cap: 200 photos per sync run

		for ( $p = 0; $p < $max_pages; $p++ ) {
			$search = $api->search( '*', array(
				'type' => 'IMAGES',
				'from' => $offset,
				'size' => $page_size,
			) );

			if ( is_wp_error( $search ) ) {
				$result = array(
					'imported' => $imported,
					'errors'   => $errors,
					'status'   => 'error',
					'message'  => $search->get_error_message(),
				);
				update_option( self::OPTION_LAST, current_time( 'mysql' ) );
				update_option( self::OPTION_RESULT, $result );
				return $result;
			}

			$assets = isset( $search['assets'] ) ? $search['assets'] : array();
			if ( empty( $assets ) ) {
				break;
			}

			$hit_duplicate = false;
			foreach ( $assets as $asset ) {
				$cimageid = isset( $asset['CIMAGEID'] ) ? $asset['CIMAGEID'] : ( isset( $asset['cimageid'] ) ? $asset['cimageid'] : '' );
				if ( empty( $cimageid ) ) {
					continue;
				}

				// If already imported, we've caught up — stop.
				if ( $sideloader->find_existing( $cimageid ) ) {
					$hit_duplicate = true;
					break;
				}

				$attachment_id = $sideloader->import( $cimageid );
				if ( is_wp_error( $attachment_id ) ) {
					$errors++;
				} else {
					$imported++;
				}
			}

			if ( $hit_duplicate ) {
				break;
			}

			$offset += $page_size;
			if ( $offset >= ( isset( $search['total'] ) ? (int) $search['total'] : 0 ) ) {
				break;
			}
		}

		$result = array(
			'imported' => $imported,
			'errors'   => $errors,
			'status'   => 'ok',
		);
		update_option( self::OPTION_LAST, current_time( 'mysql' ) );
		update_option( self::OPTION_RESULT, $result );

		return $result;
	}
}
