( function() {
	const { registerPlugin } = wp.plugins;
	const { PluginSidebar, PluginSidebarMoreMenuItem } = wp.editPost || wp.editor;
	const { createElement: el, useState, useCallback, useEffect, useRef } = wp.element;
	const { PanelBody, TextControl, Button, Spinner } = wp.components;
	const { useDispatch, useSelect } = wp.data;
	const apiFetch = wp.apiFetch;

	const NAMESPACE = 'newspack-merlinone/v1';

	function MerlinOnePanel() {
		const [ query, setQuery ] = useState( '' );
		const [ results, setResults ] = useState( [] );
		const [ total, setTotal ] = useState( 0 );
		const [ page, setPage ] = useState( 1 );
		const [ pages, setPages ] = useState( 0 );
		const [ loading, setLoading ] = useState( false );
		const [ error, setError ] = useState( '' );
		const [ idInput, setIdInput ] = useState( '' );
		// Edit panel state.
		const [ editData, setEditData ] = useState( null );
		const [ editCaption, setEditCaption ] = useState( '' );
		const [ editCredit, setEditCredit ] = useState( '' );
		const [ editAsFeatured, setEditAsFeatured ] = useState( false );
		const [ importing, setImporting ] = useState( false );

		const { getSelectedBlockClientId, getBlockIndex, getBlockRootClientId } = wp.data.select( 'core/block-editor' );
		const { insertBlock } = useDispatch( 'core/block-editor' );
		const { editPost } = useDispatch( 'core/editor' );

		const lastSelectedBlock = useRef( null );
		var currentSelected = useSelect( function( select ) {
			return select( 'core/block-editor' ).getSelectedBlockClientId();
		}, [] );
		useEffect( function() {
			if ( currentSelected ) {
				lastSelectedBlock.current = currentSelected;
			}
		}, [ currentSelected ] );

		const pageSize = 20;

		// Search WP media library for MerlinOne photos.
		const doSearch = useCallback( function( p ) {
			if ( ! query.trim() ) return;
			setLoading( true );
			setError( '' );
			var pageNum = typeof p === 'number' ? p : 1;
			apiFetch( {
				path: NAMESPACE + '/search',
				method: 'POST',
				data: { query: query, page: pageNum, per_page: pageSize },
			} ).then( function( res ) {
				setResults( res.assets || [] );
				setTotal( res.total || 0 );
				setPage( res.page || 1 );
				setPages( res.pages || 0 );
				setLoading( false );
			} ).catch( function( err ) {
				setError( err.message || 'Search failed' );
				setLoading( false );
			} );
		}, [ query ] );

		// Look up by Merlin IDs — imports on demand, returns WP data.
		var doLookup = function() {
			if ( ! idInput.trim() ) return;
			setLoading( true );
			setError( '' );
			setResults( [] );
			apiFetch( {
				path: NAMESPACE + '/lookup',
				method: 'POST',
				data: { ids: idInput.trim() },
			} ).then( function( res ) {
				var assets = res.assets || [];
				setResults( assets );
				setTotal( assets.length );
				setPage( 1 );
				setPages( 1 );
				setLoading( false );
				if ( res.errors && res.errors.length ) {
					setError( res.errors.map( function( e ) { return e.id + ': ' + e.error; } ).join( '; ' ) );
				}
			} ).catch( function( err ) {
				setError( err.message || 'Lookup failed' );
				setLoading( false );
			} );
		};

		// Click a result → go straight to edit panel.
		var doSelect = function( asset, asFeatured ) {
			setEditData( asset );
			setEditCaption( asset.caption || '' );
			setEditCredit( asset.credit || '' );
			setEditAsFeatured( asFeatured || false );
		};

		// Confirm insert.
		var doConfirmInsert = function() {
			if ( ! editData ) return;
			var selectedId = lastSelectedBlock.current || getSelectedBlockClientId();
			var rootId = selectedId ? getBlockRootClientId( selectedId ) : '';
			var insertIndex = selectedId ? getBlockIndex( selectedId ) + 1 : undefined;

			var captionHtml = editCaption;
			if ( editCredit ) {
				captionHtml += ( captionHtml ? ' ' : '' ) + '(' + editCredit + ')';
			}

			// Persist caption/credit changes.
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
				label: 'Search MerlinOne Photos',
				value: query,
				onChange: setQuery,
				onKeyDown: function( e ) { if ( e.key === 'Enter' ) doSearch( 1 ); },
			} ),
			el( Button, { variant: 'primary', onClick: function() { doSearch( 1 ); }, disabled: loading || ! query.trim() }, 'Search' ),

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

			// Edit panel — shown when a result is selected.
			editData && el( 'div', { className: 'merlinone-edit-panel', style: { border: '1px solid #ddd', padding: '12px', marginTop: '12px', background: '#f9f9f9' } },
				el( 'h3', { style: { marginTop: 0, fontSize: '13px', textTransform: 'uppercase' } },
					editAsFeatured ? 'Review Featured Image' : 'Review Image'
				),
				el( 'img', { src: editData.url, style: { width: '100%', height: 'auto', marginBottom: '8px' } } ),
				el( 'table', { style: { width: '100%', fontSize: '12px', marginBottom: '12px', borderCollapse: 'collapse' } },
					el( 'tbody', null,
						el( 'tr', null,
							el( 'td', { style: { padding: '2px 8px 2px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Merlin ID' ),
							el( 'td', { style: { padding: '2px 0' } }, editData.cimageid || '—' )
						),
						el( 'tr', null,
							el( 'td', { style: { padding: '2px 8px 2px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Title' ),
							el( 'td', { style: { padding: '2px 0' } }, editData.title || '—' )
						),
						el( 'tr', null,
							el( 'td', { style: { padding: '2px 8px 2px 0', fontWeight: '600', whiteSpace: 'nowrap', verticalAlign: 'top' } }, 'Byline' ),
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

			// Results list — instant thumbnails from WP.
			! editData && el( 'div', { className: 'merlinone-results' },
				results.map( function( asset ) {
					var thumb = asset.thumbnail_url || '';
					var title = asset.title || '';
					var credit = asset.credit || '';
					var date = asset.date ? asset.date.substring( 0, 10 ) : '';

					return el( 'div', {
						key: asset.attachment_id,
						className: 'merlinone-result',
						style: { cursor: 'pointer' },
						onClick: function() { doSelect( asset, false ); },
					},
						el( 'div', { style: { display: 'flex', gap: '8px' } },
							el( 'div', { style: { width: '80px', minWidth: '80px', height: '60px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } },
								thumb
									? el( 'img', { src: thumb, alt: title, style: { width: '100%', height: '100%', objectFit: 'cover' } } )
									: el( 'span', { style: { fontSize: '10px', color: '#999' } }, 'No thumb' )
							),
							el( 'div', { style: { flex: 1, minWidth: 0 } },
								el( 'p', { style: { margin: '0 0 2px', fontWeight: '600', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, title || 'ID: ' + asset.cimageid ),
								credit && el( 'p', { style: { margin: 0, fontSize: '11px', color: '#666' } }, credit ),
								date && el( 'p', { style: { margin: 0, fontSize: '11px', color: '#999' } }, date )
							),
							el( Button, {
								variant: 'tertiary',
								style: { alignSelf: 'center', fontSize: '11px' },
								onClick: function( e ) { e.stopPropagation(); doSelect( asset, true ); },
							}, 'Featured' )
						)
					);
				} )
			),

			// Pagination.
			! editData && pages > 1 && el( 'div', { className: 'merlinone-pagination' },
				page > 1 && el( Button, { variant: 'tertiary', onClick: function() { doSearch( page - 1 ); } }, '\u2190 Prev' ),
				el( 'span', null, 'Page ' + page + ' of ' + pages ),
				page < pages && el( Button, { variant: 'tertiary', onClick: function() { doSearch( page + 1 ); } }, 'Next \u2192' )
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
