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

		const pageSize = 20;

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

		// Seed inline thumbs from search results, then batch-fetch any that are still missing.
		useEffect( function() {
			var cancelled = false;

			// Collect inline thumbnail URLs returned by the search/lookup response.
			var seeded = {};
			results.forEach( function( a ) {
				var id = a.CIMAGEID || a.cimageid || a.id;
				if ( id && a.thumbnail_url ) {
					seeded[ id ] = a.thumbnail_url;
				}
			} );

			// Determine which IDs still need fetching (not inline, not previously cached).
			var ids = results.map( function( a ) { return a.CIMAGEID || a.cimageid || a.id; } ).filter( Boolean );
			var missing = ids.filter( function( id ) { return ! seeded[ id ]; } );

			// Apply inline thumbs immediately.
			if ( Object.keys( seeded ).length > 0 ) {
				setThumbs( function( prev ) { return Object.assign( {}, prev, seeded ); } );
			}

			// Batch-fetch the rest from the server.
			if ( missing.length > 0 ) {
				apiFetch( {
					path: NAMESPACE + '/thumbnails',
					method: 'POST',
					data: { ids: missing.join( ',' ) },
				} ).then( function( res ) {
					if ( cancelled ) return;
					if ( res.thumbnails ) {
						setThumbs( function( prev ) { return Object.assign( {}, prev, res.thumbnails ); } );
					}
				} ).catch( function() {} );
			}

			return function() { cancelled = true; };
		}, [ results ] );

		var doImport = function( cimageid, asFeatured ) {
			setImporting( cimageid );
			setEditAsFeatured( asFeatured );
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

			// Results list — hidden when editing.
			! editData && el( 'div', { className: 'merlinone-results' },
				results.map( function( asset ) {
					var id = asset.CIMAGEID || asset.cimageid || asset.id;
					var title = asset.cobject205 || asset.COBJECT205 || asset.title || id;
					var thumb = thumbs[ id ] || asset.thumbnail_url || '';
					var isImporting = importing === id;

					return el( 'div', { key: id, className: 'merlinone-result' },
						thumb && el( 'img', { src: thumb, alt: title, className: 'merlinone-thumb' } ),
						el( 'p', { className: 'merlinone-title' }, title ),
						el( 'div', { className: 'merlinone-actions' },
							el( Button, {
								variant: 'secondary',
								isBusy: isImporting,
								disabled: !!importing,
								onClick: function() { doImport( String( id ), false ); },
							}, 'Insert Image' ),
							el( Button, {
								variant: 'tertiary',
								isBusy: isImporting,
								disabled: !!importing,
								onClick: function() { doImport( String( id ), true ); },
							}, 'Featured' )
						)
					);
				} )
			),

			! editData && total > pageSize && el( 'div', { className: 'merlinone-pagination' },
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
