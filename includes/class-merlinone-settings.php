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
			<script>
			document.getElementById('merlinone-test-connection').addEventListener('click', function() {
				var result = document.getElementById('merlinone-test-result');
				result.textContent = 'Testing...';
				fetch(wpApiSettings.root + 'newspack-merlinone/v1/status', {
					headers: { 'X-WP-Nonce': wpApiSettings.nonce }
				})
				.then(function(r) { return r.json(); })
				.then(function(data) {
					result.textContent = data.connected ? '✓ Connected' : '✗ ' + (data.error || 'Failed') + (data.url ? ' (URL: ' + data.url + ')' : '') + (data.code ? ' [' + data.code + ']' : '') + (data.step ? ' (step: ' + data.step + ')' : '');
					result.style.color = data.connected ? 'green' : 'red';
				})
				.catch(function() {
					result.textContent = '✗ Request failed';
					result.style.color = 'red';
				});
			});
			</script>
		</div>
		<?php
	}
}

new Merlinone_Settings();
