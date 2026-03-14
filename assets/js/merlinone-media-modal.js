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

		// Fetch thumbnails with concurrency limit.
		useEffect( function() {
			var cancelled = false;
			var ids = results.map( function( a ) { return a.CIMAGEID || a.cimageid || a.id; } ).filter( Boolean );
			var queue = ids.filter( function( id ) { return ! thumbs[ id ]; } );
			var active = 0;
			var LIMIT = 5;

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

		var doImport = function( cimageid, asFeatured ) {
			var selectedId = lastSelectedBlock.current || getSelectedBlockClientId();
			var rootId = selectedId ? getBlockRootClientId( selectedId ) : '';
			var insertIndex = selectedId ? getBlockIndex( selectedId ) + 1 : undefined;
			setImporting( cimageid );
			apiFetch( {
				path: NAMESPACE + '/import',
				method: 'POST',
				data: { cimageid: cimageid },
			} ).then( function( res ) {
				setImporting( null );
				if ( asFeatured ) {
					editPost( { featured_media: res.attachment_id } );
				} else {
					var block = wp.blocks.createBlock( 'core/image', {
						id: res.attachment_id,
						url: res.url,
					} );
					wp.data.dispatch( 'core/block-editor' ).insertBlock( block, insertIndex, rootId );
				}
			} ).catch( function( err ) {
				setImporting( null );
				setError( err.message || 'Import failed' );
			} );
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

			el( 'div', { className: 'merlinone-results' },
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

			total > pageSize && el( 'div', { className: 'merlinone-pagination' },
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
