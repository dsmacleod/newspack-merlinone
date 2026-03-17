( function() {
	const { registerPlugin } = wp.plugins;
	const { PluginSidebar, PluginSidebarMoreMenuItem } = wp.editPost || wp.editor;
	const { createElement: el, useState, useCallback, useEffect, useRef } = wp.element;
	const { PanelBody, TextControl, Button, Spinner, SelectControl } = wp.components;
	const { useDispatch, useSelect } = wp.data;
	const apiFetch = wp.apiFetch;

	const NAMESPACE = 'newspack-merlinone/v1';

	function MerlinOnePanel() {
		const [ query, setQuery ] = useState( '' );
		const [ type, setType ] = useState( 'Image' );
		const [ results, setResults ] = useState( [] );
		const [ total, setTotal ] = useState( 0 );
		const [ loading, setLoading ] = useState( false );
		const [ importing, setImporting ] = useState( null );
		const [ error, setError ] = useState( '' );
		const [ page, setPage ] = useState( 0 );
		const [ thumbs, setThumbs ] = useState( {} );
		const [ idInput, setIdInput ] = useState( '' );
		// Edit step state: holds imported asset data before final insertion.
		const [ editData, setEditData ] = useState( null );
		const [ editCaption, setEditCaption ] = useState( '' );
		const [ editCredit, setEditCredit ] = useState( '' );
		const [ editAsFeatured, setEditAsFeatured ] = useState( false );
		// Detail/preview panel state.
		const [ previewAsset, setPreviewAsset ] = useState( null );
		const [ previewUrl, setPreviewUrl ] = useState( '' );
		const [ previewLoading, setPreviewLoading ] = useState( false );

		const { getSelectedBlockClientId, getBlockIndex, getBlockRootClientId } = wp.data.select( 'core/block-editor' );
		const { insertBlock } = useDispatch( 'core/block-editor' );
		const { editPost } = useDispatch( 'core/editor' );

		// Track last selected editor block so we still know where to insert after sidebar steals focus.
		const lastSelectedBlock = useRef( null );
		var currentSelected = useSelect( function( select ) {
			return select( 'core/block-editor' ).getSelectedBlockClientId();
		}, [] );
		useEffect( function() {
			if ( currentSelected ) {
				lastSelectedBlock.current = currentSelected;
			}
		}, [ currentSelected ] );

		const pageSize = 10;

		const doSearch = useCallback( function( fromOffset ) {
			if ( ! query.trim() ) return;
			setLoading( true );
			setError( '' );
			var offset = typeof fromOffset === 'number' ? fromOffset : 0;
			apiFetch( {
				path: NAMESPACE + '/search',
				method: 'POST',
				data: { query: query, type: type, from: offset, size: pageSize },
			} ).then( function( res ) {
				setResults( res.assets || [] );
				setTotal( res.total || 0 );
				setPage( Math.floor( offset / pageSize ) );
				setLoading( false );
				
			} ).catch( function( err ) {
				setError( err.message || 'Search failed' );
				setLoading( false );
			} );
		}, [ query, type ] );

		var doLookup = function() {
			if ( ! idInput.trim() ) return;
			setLoading( true );
			setError( '' );
			setResults( [] );
			setThumbs( {} );
			apiFetch( {
				path: NAMESPACE + '/lookup',
				method: 'POST',
				data: { ids: idInput.trim() },
			} ).then( function( res ) {
				var assets = res.assets || [];
				setResults( assets );
				setTotal( assets.length );
				setPage( 0 );
				setLoading( false );
				
			} ).catch( function( err ) {
				setError( err.message || 'Lookup failed' );
				setLoading( false );
			} );
		};

		// Load thumbnails individually in the background. Results show immediately
		// with metadata; thumbnails fill in as each one resolves.
		useEffect( function() {
			var cancelled = false;
			var ids = results.map( function( a ) { return a.CIMAGEID || a.cimageid || a.id; } ).filter( Boolean );
			var queue = ids.filter( function( id ) { return ! thumbs[ id ]; } );
			var active = 0;
			var LIMIT = 3;

			function next() {
				if ( cancelled || queue.length === 0 ) return;
				while ( active < LIMIT && queue.length > 0 ) {
					( function( id ) {
						active++;
						apiFetch( {
							path: NAMESPACE + '/thumbnail',
							method: 'POST',
							data: { cimageid: String( id ) },
						} ).then( function( res ) {
							active--;
							if ( cancelled ) return;
							if ( res.url ) {
								setThumbs( function( prev ) {
									var n = Object.assign( {}, prev );
									n[ id ] = res.url;
									return n;
								} );
							}
							next();
						} ).catch( function() { active--; next(); } );
					} )( queue.shift() );
				}
			}
			next();

			return function() { cancelled = true; };
		}, [ results ] );

		var doPreview = function( asset ) {
			var id = asset.CIMAGEID || asset.cimageid || asset.id;
			setPreviewAsset( asset );
			setPreviewUrl( '' );
			setPreviewLoading( true );
			// Only fetch the larger preview image — metadata is already in the asset.
			apiFetch( {
				path: NAMESPACE + '/preview',
				method: 'POST',
				data: { cimageid: String( id ) },
			} ).then( function( res ) {
				setPreviewLoading( false );
				setPreviewUrl( res.preview_url || '' );
			} ).catch( function() {
				setPreviewLoading( false );
			} );
		};

		var closePreview = function() {
			setPreviewAsset( null );
			setPreviewUrl( '' );
		};

		var doImport = function( cimageid, asFeatured ) {
			setImporting( cimageid );
			setEditAsFeatured( asFeatured );
			setPreviewAsset( null );
			setPreviewUrl( '' );
			apiFetch( {
				path: NAMESPACE + '/import',
				method: 'POST',
				data: { cimageid: cimageid },
			} ).then( function( res ) {
				setImporting( null );
				setEditData( res );
				setEditCaption( res.caption || '' );
				setEditCredit( res.credit || '' );
			} ).catch( function( err ) {
				setImporting( null );
				setError( err.message || 'Import failed' );
			} );
		};

		var doConfirmInsert = function() {
			if ( ! editData ) return;
			var selectedId = lastSelectedBlock.current || getSelectedBlockClientId();
			var rootId = selectedId ? getBlockRootClientId( selectedId ) : '';
			var insertIndex = selectedId ? getBlockIndex( selectedId ) + 1 : undefined;

			// Build caption with credit.
			var captionHtml = editCaption;
			if ( editCredit ) {
				captionHtml += ( captionHtml ? ' ' : '' ) + '(' + editCredit + ')';
			}

			// Save updated caption/credit back to the attachment only if changed.
			var captionChanged = editCaption !== ( editData.caption || '' );
			var creditChanged = editCredit !== ( editData.credit || '' );
			if ( captionChanged || creditChanged ) {
				apiFetch( {
					path: '/wp/v2/media/' + editData.attachment_id,
					method: 'POST',
					data: { caption: captionHtml },
				} ).catch( function() {} );
			}
			if ( creditChanged ) {
				apiFetch( {
					path: NAMESPACE + '/update-meta',
					method: 'POST',
					data: { attachment_id: editData.attachment_id, credit: editCredit },
				} ).catch( function() {} );
			}

			if ( editAsFeatured ) {
				editPost( { featured_media: editData.attachment_id } );
			} else {
				var block = wp.blocks.createBlock( 'core/image', {
					id: editData.attachment_id,
					url: editData.url,
					caption: captionHtml,
				} );
				insertBlock( block, insertIndex, rootId );
			}

			setEditData( null );
		};

		var doCancelEdit = function() {
			setEditData( null );
		};

		return el( 'div', { className: 'merlinone-panel' },
			el( TextControl, {
				label: 'Search MerlinOne',
				value: query,
				onChange: setQuery,
				onKeyDown: function( e ) { if ( e.key === 'Enter' ) doSearch( 0 ); },
			} ),
			el( SelectControl, {
				label: 'Type',
				value: type,
				options: [
					{ label: 'Images', value: 'Image' },
					{ label: 'Graphics', value: 'Graphic' },
					{ label: 'All', value: '' },
				],
				onChange: setType,
			} ),
			el( Button, { variant: 'primary', onClick: function() { doSearch( 0 ); }, disabled: loading || ! query.trim() }, 'Search' ),

			el( 'hr', { style: { margin: '12px 0' } } ),
			el( 'label', { style: { display: 'block', marginBottom: '4px', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase' } }, 'Merlin IDs' ),
			el( 'textarea', {
				value: idInput,
				onChange: function( e ) { setIdInput( e.target.value ); },
				placeholder: '35041548 35041523 35041590',
				rows: 3,
				style: { width: '100%', marginBottom: '8px', fontFamily: 'monospace', fontSize: '13px' },
			} ),
			el( Button, { variant: 'secondary', onClick: doLookup, disabled: loading || ! idInput.trim() }, 'Look Up IDs' ),

			error && el( 'p', { className: 'merlinone-error' }, error ),
			loading && el( Spinner ),

			// Edit/review panel — shown after import, before insertion.
			editData && el( 'div', { className: 'merlinone-edit-panel', style: { border: '1px solid #ddd', padding: '12px', marginTop: '12px', background: '#f9f9f9' } },
				el( 'h3', { style: { marginTop: 0, fontSize: '13px', textTransform: 'uppercase' } },
					editAsFeatured ? 'Review Featured Image' : 'Review Image'
				),
				el( 'img', { src: editData.url, style: { width: '100%', height: 'auto', marginBottom: '8px' } } ),
				el( 'table', { style: { width: '100%', fontSize: '12px', marginBottom: '12px', borderCollapse: 'collapse' } },
					el( 'tbody', null,
						el( 'tr', null,
							el( 'td', { style: { padding: '2px 8px 2px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Merlin ID'),
							el( 'td', { style: { padding: '2px 0' } }, editData.cimageid || '—' )
						),
						el( 'tr', null,
							el( 'td', { style: { padding: '2px 8px 2px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Title'),
							el( 'td', { style: { padding: '2px 0' } }, editData.title || '—' )
						),
						el( 'tr', null,
							el( 'td', { style: { padding: '2px 8px 2px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Byline'),
							el( 'td', { style: { padding: '2px 0' } }, editData.byline || '—' )
						)
					)
				),
				el( 'label', { style: { display: 'block', fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' } }, 'Caption' ),
				el( 'textarea', {
					value: editCaption,
					onChange: function( e ) { setEditCaption( e.target.value ); },
					rows: 3,
					style: { width: '100%', marginBottom: '8px', fontSize: '13px' },
				} ),
				el( TextControl, {
					label: 'Credit',
					value: editCredit,
					onChange: setEditCredit,
				} ),
				el( 'div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
					el( Button, { variant: 'primary', onClick: doConfirmInsert },
						editAsFeatured ? 'Set as Featured Image' : 'Insert Image'
					),
					el( Button, { variant: 'tertiary', onClick: doCancelEdit }, 'Cancel' )
				)
			),

			// Detail/preview panel — metadata shows instantly, image loads in background.
			previewAsset && ! editData && ( function() {
				var pId = String( previewAsset.CIMAGEID || previewAsset.cimageid || previewAsset.id );
				var pTitle = ( previewAsset.COBJECT205 || previewAsset.cobject205 || '' ).trim();
				var pCaption = ( previewAsset.CAPT2120 || previewAsset.capt2120 || '' ).trim();
				var pCredit = ( previewAsset.CREDIT2110 || previewAsset.credit2110 || '' ).trim();
				var pByline = ( previewAsset.CBYLINE280 || previewAsset.cbyline280 || '' ).trim();
				var pDate = previewAsset.DATECR255 || previewAsset.datecr255 || '';
				if ( pDate ) { pDate = pDate.substring( 0, 10 ); }
				var pKeywords = ( previewAsset.CKEYWORDS || previewAsset.ckeywords || '' ).trim();

				return el( 'div', { className: 'merlinone-preview-panel', style: { marginTop: '12px' } },
					el( Button, { variant: 'tertiary', onClick: closePreview, style: { marginBottom: '8px' } }, '\u2190 Back to results' ),
					el( 'div', { style: { width: '100%', minHeight: '120px', background: '#eee', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
						previewUrl
							? el( 'img', { src: previewUrl, style: { width: '100%', height: 'auto' } } )
							: ( previewLoading ? el( Spinner ) : null )
					),
					el( 'table', { style: { width: '100%', fontSize: '12px', marginBottom: '12px', borderCollapse: 'collapse' } },
						el( 'tbody', null,
							el( 'tr', null,
								el( 'td', { style: { padding: '3px 8px 3px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Merlin ID' ),
								el( 'td', { style: { padding: '3px 0' } }, pId )
							),
							pTitle && el( 'tr', null,
								el( 'td', { style: { padding: '3px 8px 3px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Title' ),
								el( 'td', { style: { padding: '3px 0' } }, pTitle )
							),
							pCaption && el( 'tr', null,
								el( 'td', { style: { padding: '3px 8px 3px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Caption' ),
								el( 'td', { style: { padding: '3px 0' } }, pCaption )
							),
							pCredit && el( 'tr', null,
								el( 'td', { style: { padding: '3px 8px 3px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Credit' ),
								el( 'td', { style: { padding: '3px 0' } }, pCredit )
							),
							pByline && el( 'tr', null,
								el( 'td', { style: { padding: '3px 8px 3px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Byline' ),
								el( 'td', { style: { padding: '3px 0' } }, pByline )
							),
							pDate && el( 'tr', null,
								el( 'td', { style: { padding: '3px 8px 3px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Date' ),
								el( 'td', { style: { padding: '3px 0' } }, pDate )
							),
							pKeywords && el( 'tr', null,
								el( 'td', { style: { padding: '3px 8px 3px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Keywords' ),
								el( 'td', { style: { padding: '3px 0' } }, pKeywords )
							)
						)
					),
					el( 'div', { style: { display: 'flex', gap: '8px' } },
						el( Button, {
							variant: 'primary',
							isBusy: importing === pId,
							disabled: !!importing,
							onClick: function() { doImport( pId, false ); },
						}, 'Insert Image' ),
						el( Button, {
							variant: 'secondary',
							isBusy: importing === pId,
							disabled: !!importing,
							onClick: function() { doImport( pId, true ); },
						}, 'Featured' )
					)
				);
			} )(),

			// Results list — hidden when previewing or editing.
			! editData && ! previewAsset && el( 'div', { className: 'merlinone-results' },
				results.map( function( asset ) {
					var id = asset.CIMAGEID || asset.cimageid || asset.id;
					var title = ( asset.cobject205 || asset.COBJECT205 || asset.title || '' ).trim();
					var credit = asset.CREDIT2110 || asset.credit2110 || '';
					var date = asset.DATECR255 || asset.datecr255 || '';
					if ( date ) { date = date.substring( 0, 10 ); }
					var thumb = thumbs[ id ] || '';
					var isImporting = importing === id;

					return el( 'div', { key: id, className: 'merlinone-result', onClick: function() { doPreview( asset ); }, style: { cursor: 'pointer' } },
						el( 'div', { style: { display: 'flex', gap: '8px' } },
							el( 'div', { style: { width: '80px', minWidth: '80px', height: '60px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
								thumb
									? el( 'img', { src: thumb, alt: title, style: { width: '100%', height: '100%', objectFit: 'cover' } } )
									: el( Spinner )
							),
							el( 'div', { style: { flex: 1, minWidth: 0 } },
								el( 'p', { style: { margin: '0 0 2px', fontWeight: '600', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, title || 'ID: ' + id ),
								credit && el( 'p', { style: { margin: 0, fontSize: '11px', color: '#666' } }, credit ),
								date && el( 'p', { style: { margin: 0, fontSize: '11px', color: '#999' } }, date )
							)
						)
					);
				} )
			),

			! editData && ! previewAsset && total > pageSize && el( 'div', { className: 'merlinone-pagination' },
				page > 0 && el( Button, { variant: 'tertiary', onClick: function() { doSearch( ( page - 1 ) * pageSize ); } }, '← Prev' ),
				el( 'span', null, 'Page ' + ( page + 1 ) + ' of ' + Math.ceil( total / pageSize ) ),
				( page + 1 ) * pageSize < total && el( Button, { variant: 'tertiary', onClick: function() { doSearch( ( page + 1 ) * pageSize ); } }, 'Next →' )
			)
		);
	}

	var wizardIcon = el( 'svg', { width: 20, height: 20, viewBox: '0 0 24 24', xmlns: 'http://www.w3.org/2000/svg' },
		el( 'path', { d: 'M12 2L6 18h12L12 2zm-4.5 18c-.83 0-1.5.67-1.5 1.5S6.67 23 7.5 23h9c.83 0 1.5-.67 1.5-1.5S17.33 20 16.5 20h-9z', fill: 'currentColor' } ),
		el( 'path', { d: 'M19 5l.75 1.5L21.25 7.25 19.75 8 19 9.5 18.25 8 16.75 7.25 18.25 6.5z', fill: 'currentColor' } )
	);

	registerPlugin( 'newspack-merlinone', {
		icon: wizardIcon,
		render: function() {
			return el( wp.element.Fragment, null,
				el( PluginSidebarMoreMenuItem, { target: 'newspack-merlinone-sidebar' }, 'MerlinOne DAM' ),
				el( PluginSidebar, {
					name: 'newspack-merlinone-sidebar',
					title: 'MerlinOne DAM',
					icon: wizardIcon,
				}, el( PanelBody, { title: 'Search Assets', initialOpen: true }, el( MerlinOnePanel ) ) )
			);
		},
	} );
} )();
