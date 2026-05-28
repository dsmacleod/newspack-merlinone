<?php
/**
 * Auto-attach Merlin photos to posts created by the BDN Send-to-WordPress receiver.
 *
 * Reads _bdn_merlin_pending postmeta (written by bdn-metadata's Doc_Receiver)
 * and either:
 *   - sideloads the photo and sets it as featured image (single ID + "lede" flag)
 *   - sideloads the photo and inserts an image block at the comment anchor position
 *     (single ID, no "lede" flag)
 *   - inserts a "pick one or make a gallery" placeholder block (multiple IDs)
 *
 * Hooks bdn_doc_imported at priority 20 (after bdn-metadata Airtable enrichment at 10).
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class Merlinone_Auto_Attach {

	const META_PENDING = '_bdn_merlin_pending';
	const META_ANCHORS = '_bdn_comment_anchors';

	private $sideloader;

	public function __construct( ?Merlinone_Sideloader $sideloader = null ) {
		$this->sideloader = $sideloader;
	}

	public function register() {
		add_action( 'bdn_doc_imported', array( $this, 'attach' ), 20, 3 );
	}

	/**
	 * Process pending Merlin directives for a post.
	 *
	 * @param int    $post_id          Post created by Doc_Receiver.
	 * @param string $doc_id           Google Doc ID (unused here, but part of the action signature).
	 * @param array  $parsed_comments  Doc_Comment_Parser output. We also read postmeta as a fallback.
	 */
	public function attach( $post_id, $doc_id, $parsed_comments ) {
		$pending = isset( $parsed_comments['merlin'] ) && is_array( $parsed_comments['merlin'] )
			? $parsed_comments['merlin']
			: get_post_meta( $post_id, self::META_PENDING, true );

		if ( empty( $pending ) || ! is_array( $pending ) ) {
			return;
		}

		$anchors  = get_post_meta( $post_id, self::META_ANCHORS, true );
		if ( ! is_array( $anchors ) ) {
			$anchors = array();
		}

		$post = get_post( $post_id );
		if ( ! $post ) {
			return;
		}

		$content       = $post->post_content;
		$featured_id   = 0;
		$lede_consumed = false;

		// Process in order. First "lede" entry wins.
		foreach ( $pending as $entry ) {
			$ids       = isset( $entry['ids'] ) && is_array( $entry['ids'] ) ? $entry['ids'] : array();
			$is_lede   = ! empty( $entry['lede'] );
			$anchor_id = isset( $entry['anchor_id'] ) ? $entry['anchor_id'] : null;

			if ( empty( $ids ) ) {
				continue;
			}

			// Multi-ID: placeholder block, no sideload.
			if ( count( $ids ) > 1 ) {
				$content = $this->insert_at_anchor(
					$content,
					$this->multi_id_placeholder_block( $ids ),
					$anchors,
					$anchor_id
				);
				continue;
			}

			$cimageid = $ids[0];

			// Single ID: sideload.
			$attachment_id = $this->sideloader()->import( $cimageid );
			if ( is_wp_error( $attachment_id ) ) {
				$content = $this->insert_at_anchor(
					$content,
					$this->error_placeholder_block( $cimageid, $attachment_id->get_error_message() ),
					$anchors,
					$anchor_id
				);
				continue;
			}

			// Lede → featured image (first one wins).
			if ( $is_lede && ! $lede_consumed ) {
				$featured_id   = $attachment_id;
				$lede_consumed = true;
				continue;
			}

			// Otherwise, insert at the anchored paragraph.
			$content = $this->insert_at_anchor(
				$content,
				$this->image_block( $attachment_id ),
				$anchors,
				$anchor_id
			);
		}

		$update = array( 'ID' => $post_id );
		if ( $content !== $post->post_content ) {
			$update['post_content'] = $content;
		}
		if ( count( $update ) > 1 ) {
			wp_update_post( $update );
		}

		if ( $featured_id ) {
			set_post_thumbnail( $post_id, $featured_id );
		}

		// Mark processed so this never re-runs.
		delete_post_meta( $post_id, self::META_PENDING );
	}

	private function sideloader() {
		if ( ! $this->sideloader ) {
			$this->sideloader = new Merlinone_Sideloader();
		}
		return $this->sideloader;
	}

	/**
	 * Build a Gutenberg core/image block for an attachment.
	 */
	private function image_block( $attachment_id ) {
		$url     = wp_get_attachment_url( $attachment_id );
		$alt     = get_post_meta( $attachment_id, '_wp_attachment_image_alt', true );
		$caption = get_post_field( 'post_excerpt', $attachment_id );

		$attrs = array(
			'id'              => (int) $attachment_id,
			'sizeSlug'        => 'large',
			'linkDestination' => 'none',
		);

		$figure  = '<figure class="wp-block-image size-large">';
		$figure .= sprintf(
			'<img src="%s" alt="%s" class="wp-image-%d"/>',
			esc_url( $url ),
			esc_attr( $alt ),
			(int) $attachment_id
		);
		if ( $caption ) {
			$figure .= '<figcaption>' . wp_kses_post( $caption ) . '</figcaption>';
		}
		$figure .= '</figure>';

		return "<!-- wp:image " . wp_json_encode( $attrs ) . " -->\n{$figure}\n<!-- /wp:image -->";
	}

	/**
	 * Loud placeholder telling the editor multiple Merlin IDs were submitted.
	 */
	private function multi_id_placeholder_block( $ids ) {
		$id_list = implode( ', ', array_map( 'esc_html', $ids ) );
		$msg     = sprintf(
			'<strong>BDN:</strong> %d photo candidates pending — Merlin IDs %s. Pick one or make a gallery.',
			count( $ids ),
			$id_list
		);
		return "<!-- wp:paragraph {\"className\":\"bdn-merlin-pending\"} -->\n<p class=\"bdn-merlin-pending\">{$msg}</p>\n<!-- /wp:paragraph -->";
	}

	/**
	 * Placeholder when Merlin import for a single ID fails.
	 */
	private function error_placeholder_block( $cimageid, $error_message ) {
		$msg = sprintf(
			'<strong>BDN:</strong> Merlin photo %s could not be imported — %s',
			esc_html( $cimageid ),
			esc_html( $error_message )
		);
		return "<!-- wp:paragraph {\"className\":\"bdn-merlin-error\"} -->\n<p class=\"bdn-merlin-error\">{$msg}</p>\n<!-- /wp:paragraph -->";
	}

	/**
	 * Insert a block of HTML into $content after the paragraph identified by
	 * $anchor_id in $anchors. If no anchor info is available, append.
	 */
	private function insert_at_anchor( $content, $block_html, $anchors, $anchor_id ) {
		$paragraph_index = null;
		if ( $anchor_id && isset( $anchors[ $anchor_id ] ) ) {
			$paragraph_index = (int) $anchors[ $anchor_id ];
		}

		if ( $paragraph_index === null ) {
			return rtrim( $content ) . "\n\n" . $block_html;
		}

		// Split by paragraph blocks. We accept either Gutenberg <!-- wp:paragraph -->
		// blocks or bare <p>...</p> elements; Doc_Content_Cleaner emits bare <p>.
		$pattern = '/(<p[^>]*>.*?<\/p>)/is';
		if ( ! preg_match_all( $pattern, $content, $matches, PREG_OFFSET_CAPTURE ) ) {
			return rtrim( $content ) . "\n\n" . $block_html;
		}

		$paragraphs = $matches[0];
		if ( ! isset( $paragraphs[ $paragraph_index ] ) ) {
			return rtrim( $content ) . "\n\n" . $block_html;
		}

		$target       = $paragraphs[ $paragraph_index ];
		$insert_after = $target[1] + strlen( $target[0] );

		return substr( $content, 0, $insert_after ) . "\n\n" . $block_html . substr( $content, $insert_after );
	}
}
