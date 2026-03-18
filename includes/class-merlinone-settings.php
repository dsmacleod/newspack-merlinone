<?php
/**
 * Settings page for MerlinOne integration.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Merlinone_Settings {

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_menu' ) );
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_scripts' ) );
	}

	public function enqueue_scripts( $hook ) {
		if ( $hook !== 'settings_page_newspack-merlinone' ) {
			return;
		}
		wp_enqueue_script( 'wp-api' );
	}

	public function add_menu() {
		add_options_page(
			'MerlinOne DAM',
			'MerlinOne DAM',
			'manage_options',
			'newspack-merlinone',
			array( $this, 'render_page' )
		);
	}

	public function register_settings() {
		// Connection settings.
		add_settings_section( 'merlinone_main', 'Connection Settings', '__return_null', 'newspack-merlinone' );

		$fields = array(
			'url'      => 'MerlinOne URL',
			'username' => 'Username',
			'password' => 'Password',
		);

		foreach ( $fields as $key => $label ) {
			$option = 'newspack_merlinone_' . $key;
			register_setting( 'newspack_merlinone', $option );

			$constant = 'MERLINONE_' . strtoupper( $key );
			$disabled = defined( $constant );

			add_settings_field( $option, $label, function() use ( $key, $option, $disabled ) {
				$type  = ( $key === 'password' ) ? 'password' : 'text';
				$value = $disabled ? '••••••••' : esc_attr( get_option( $option, '' ) );
				$attrs = $disabled ? 'disabled' : '';
				echo '<input type="' . esc_attr( $type ) . '" name="' . esc_attr( $option ) . '" value="' . esc_attr( $value ) . '" class="regular-text" ' . $attrs . ' />';
				if ( $disabled ) {
					echo '<p class="description">Set via <code>' . esc_html( 'MERLINONE_' . strtoupper( $key ) ) . '</code> constant.</p>';
				}
			}, 'newspack-merlinone', 'merlinone_main' );
		}

		// Background Sync settings.
		add_settings_section( 'merlinone_sync', 'Background Sync', '__return_null', 'newspack-merlinone' );

		register_setting( 'newspack_merlinone', Merlinone_Sync::OPTION_ENABLE );

		add_settings_field(
			Merlinone_Sync::OPTION_ENABLE,
			'Enable Background Sync',
			function() {
				$enabled = get_option( Merlinone_Sync::OPTION_ENABLE, false );
				echo '<label><input type="checkbox" name="' . esc_attr( Merlinone_Sync::OPTION_ENABLE ) . '" value="1" ' . checked( $enabled, true, false ) . ' /> Import new MerlinOne photos automatically every 15 minutes</label>';
			},
			'newspack-merlinone',
			'merlinone_sync'
		);
	}

	public function render_page() {
		?>
		<div class="wrap">
			<h1>MerlinOne DAM Settings</h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'newspack_merlinone' );
				do_settings_sections( 'newspack-merlinone' );
				submit_button();
				?>
			</form>
			<hr>
			<h2>Connection Test</h2>
			<button type="button" class="button" id="merlinone-test-connection">Test Connection</button>
			<span id="merlinone-test-result"></span>

			<hr>
			<h2>Sync Status</h2>
			<table class="form-table" id="merlinone-sync-status">
				<tr><th>Total MerlinOne Photos in WP</th><td id="sync-total">—</td></tr>
				<tr><th>Last Sync</th><td id="sync-last">—</td></tr>
				<tr><th>Last Result</th><td id="sync-result">—</td></tr>
				<tr><th>Next Scheduled</th><td id="sync-next">—</td></tr>
			</table>
			<button type="button" class="button button-primary" id="merlinone-sync-now">Sync Now</button>
			<span id="merlinone-sync-feedback"></span>

			<script>
			(function() {
				var root = wpApiSettings.root;
				var nonce = wpApiSettings.nonce;
				var headers = { 'X-WP-Nonce': nonce };

				// Connection test.
				document.getElementById('merlinone-test-connection').addEventListener('click', function() {
					var result = document.getElementById('merlinone-test-result');
					result.textContent = 'Testing...';
					fetch(root + 'newspack-merlinone/v1/status', { headers: headers })
					.then(function(r) { return r.json(); })
					.then(function(data) {
						result.textContent = data.connected ? '✓ Connected' : '✗ ' + (data.error || 'Failed');
						result.style.color = data.connected ? 'green' : 'red';
					})
					.catch(function() {
						result.textContent = '✗ Request failed';
						result.style.color = 'red';
					});
				});

				// Load sync status.
				function loadSyncStatus() {
					fetch(root + 'newspack-merlinone/v1/sync-status', { headers: headers })
					.then(function(r) { return r.json(); })
					.then(function(data) {
						document.getElementById('sync-total').textContent = data.total_photos;
						document.getElementById('sync-last').textContent = data.last_sync || 'Never';
						var lr = data.last_result || {};
						document.getElementById('sync-result').textContent = lr.status
							? lr.status + ' (imported: ' + (lr.imported || 0) + ', errors: ' + (lr.errors || 0) + ')'
							: '—';
						document.getElementById('sync-next').textContent = data.next_scheduled
							? new Date(data.next_scheduled * 1000).toLocaleString()
							: 'Not scheduled';
					});
				}
				loadSyncStatus();

				// Sync now button.
				document.getElementById('merlinone-sync-now').addEventListener('click', function() {
					var fb = document.getElementById('merlinone-sync-feedback');
					var btn = this;
					btn.disabled = true;
					fb.textContent = 'Syncing…';
					fb.style.color = '';
					fetch(root + 'newspack-merlinone/v1/sync', {
						method: 'POST',
						headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
					})
					.then(function(r) { return r.json(); })
					.then(function(data) {
						btn.disabled = false;
						fb.textContent = 'Done — imported ' + (data.imported || 0) + ' photos' + (data.errors ? ', ' + data.errors + ' errors' : '');
						fb.style.color = data.status === 'ok' ? 'green' : 'orange';
						loadSyncStatus();
					})
					.catch(function(err) {
						btn.disabled = false;
						fb.textContent = 'Sync failed: ' + (err.message || err);
						fb.style.color = 'red';
					});
				});
			})();
			</script>
		</div>
		<?php
	}
}

new Merlinone_Settings();
