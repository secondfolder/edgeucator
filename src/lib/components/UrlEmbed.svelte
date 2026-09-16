<script lang="ts">
	import {
		cachedOembed,
		embedSpecFor,
		fetchOembed,
		type CachedEmbedDetails,
		type EmbedSpec,
		type OembedResult
	} from '$lib/embeds';

	type CardView = {
		href: string;
		providerName: string | null;
		title: string | null;
		thumbnailUrl: string | null;
		mediaHref: string;
	};

	type IframeView = {
		shellClass: string;
		frameClass: string | null;
		src: string;
		title: string;
		height: number | null;
		allowFullscreen: boolean;
	};

	/**
	 * The inline embed for one supported URL.
	 *
	 * Images and curated player iframes (redgifs, youtube) render from a
	 * deterministic URL, so they are SSR-safe and load immediately. Direct
	 * oEmbed providers (noembed.com hosts) need a fetch, which runs only after
	 * mount — never during SSR/prerender, so the server makes no third-party
	 * requests and message plaintext (client-decrypted anyway) never drives
	 * server-side behaviour.
	 *
	 * `server-oembed` (reddit) is different and stricter: resolving it sends
	 * the URL to our own server, which is the one thing in this app that leaks
	 * a fragment of message plaintext server-side (see docs/privacy.md). So it
	 * never loads on its own — a placeholder card offers the embed, and only a
	 * click unlocks the fetch. The click is the consent.
	 *
	 * A failed or unknown embed silently falls back to a plain link: embeds are
	 * decoration, and a dead provider (noembed has no SLA) must not leave a
	 * hole or a console error — the e2e fixture fails runs on console noise.
	 */
	let {
		spec,
		href,
		label,
		cached = null,
		cachedPending = false,
		requireExplicitReveal = false,
		onReveal = undefined,
		onRefresh = undefined
	}: {
		spec: EmbedSpec;
		href: string;
		label: string;
		cached?: CachedEmbedDetails | null;
		cachedPending?: boolean;
		requireExplicitReveal?: boolean;
		onReveal?: ((href: string) => void | Promise<void>) | undefined;
		onRefresh?: ((href: string) => void | Promise<void>) | undefined;
	} = $props();

	// Only true after the viewer clicked the placeholder. Gates the
	// server-proxied fetch. The gate itself stays mounted until the fetch has
	// resolved, so the button can show a busy state without a layout jump.
	let unlocked = $state(false);
	let refreshing = $state(false);
	const gated = $derived(requireExplicitReveal && cached === null && !unlocked);
	const canRefresh = $derived(cached !== null && onRefresh !== undefined);

	// The endpoint actually fetched: direct for noembed hosts, our proxy for
	// reddit — but only once `unlocked`.
	const endpoint = $derived(
		cached !== null || cachedPending || gated
			? null
			: spec.kind === 'oembed'
				? spec.endpoint
				: spec.kind === 'server-oembed' && unlocked
					? `/api/oembed?url=${encodeURIComponent(spec.url)}`
					: null
	);

	// svelte-ignore state_referenced_locally
	// Deliberate initial capture: the cached value seeds the state and the
	// $effect below is what keeps it live, so re-deriving on every prop change
	// would restart settled fetches for nothing.
	let oembed: OembedResult | 'error' | undefined = $state(
		endpoint === null ? undefined : cachedOembed(endpoint)
	);
	const cachedCard = $derived.by(() => {
		if (!cached) return null;
		if (!cached.title && !cached.providerName && !cached.thumbnailUrl && !cached.description) {
			return null;
		}
		return {
			href: cached.canonicalUrl ?? href,
			providerName: cached.providerName,
			title: cached.title,
			thumbnailUrl: cached.thumbnailUrl,
			mediaHref: cached.canonicalUrl ?? href
		} satisfies CardView;
	});

	const cachedCardImage = $derived.by(() => {
		if (!cached || cached.kind !== 'image' || !cached.imageUrl) return null;
		return {
			href: cached.canonicalUrl ?? href,
			src: cached.imageUrl,
			alt: label
		};
	});

	const cachedIframeEmbed = $derived.by(() => {
		if (!cached || cached.kind !== 'iframe' || !cached.iframeSrc) return null;
		return {
			shellClass: cachedCard ? 'card-media player iframe-shell' : 'embed player iframe-shell',
			frameClass: null,
			src: cached.iframeSrc,
			title: cached.title ?? cached.providerName ?? 'Embedded content',
			height: cached.iframeHeight,
			allowFullscreen: true
		} satisfies IframeView;
	});

	const cachedStandaloneImage = $derived.by(() => {
		if (!cachedCardImage || cachedCard) return null;
		return cachedCardImage;
	});

	const gateVisible = $derived(
		!cachedPending &&
			cached === null &&
			(gated || (spec.kind === 'server-oembed' && (!unlocked || oembed === undefined)))
	);
	const waitingForRedditEmbed = $derived(
		(spec.kind === 'server-oembed' || spec.kind === 'oembed') && unlocked && oembed === undefined
	);

	async function reveal(): Promise<void> {
		unlocked = true;
		await onReveal?.(href);
	}

	async function refresh(event: MouseEvent): Promise<void> {
		event.preventDefault();
		event.stopPropagation();
		if (!onRefresh || refreshing) return;
		refreshing = true;
		try {
			await onRefresh(href);
		} finally {
			refreshing = false;
		}
	}

	$effect(() => {
		if (endpoint === null) return;
		let cancelled = false;
		void fetchOembed(endpoint).then((result) => {
			if (!cancelled) oembed = result;
		});
		return () => {
			cancelled = true;
		};
	});

	/**
	 * Generic oEmbed html is only used when it contains a plain iframe we can
	 * lift out and sandbox ourselves. Anything more dynamic — scripts,
	 * blockquotes that rely on a loader, custom widgets — falls back to the
	 * metadata card rather than opening an HTML injection surface.
	 */
	const oembedFrame = $derived.by(() => {
		if (!oembed || oembed === 'error' || !oembed.html) return null;
		const match = oembed.html.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
		if (!match) return null;
		const src = match[1];
		if (!src || !/^https?:\/\//i.test(src)) return null;
		return {
			src,
			title: oembed.title ?? oembed.providerName ?? 'Embedded content',
			height: oembed.height ?? 360
		};
	});

	/**
	 * When the proxy reports the post's outbound link and we can embed it
	 * natively (a redgifs player, a direct image), that beats everything
	 * below: reddit's own frame serves dead preview images for NSFW posts, so
	 * the outbound link is the only way to show the actual media.
	 */
	const nativeSpec = $derived(
		spec.kind === 'server-oembed' && oembed && oembed !== 'error' && oembed.outbound
			? embedSpecFor(oembed.outbound)
			: null
	);

	const redditOembed = $derived(
		spec.kind === 'server-oembed' && oembed && oembed !== 'error' ? oembed : null
	);

	/**
	 * Reddit's oEmbed `html` is a blockquote plus a widget script, and neither
	 * path is usable directly: DOMPurify strips the script (leaving a bare
	 * blockquote), and running the html in a sandboxed srcdoc frame fails too —
	 * the widget's child iframe to embed.reddit.com is rejected by reddit's
	 * `frame-ancestors` because a srcdoc parent has no network scheme.
	 *
	 * So the proxy also returns the resolved permalink, and we frame
	 * embed.reddit.com directly — the same cross-origin posture as the redgifs
	 * player, which reddit's `frame-ancestors *` allows for a normal http(s)
	 * parent. `allow-same-origin` here refers to the frame's own
	 * (embed.reddit.com) origin, not ours, so it grants nothing dangerous.
	 */
	const redditFrame = $derived.by(() => {
		if (
			nativeSpec ||
			spec.kind !== 'server-oembed' ||
			!oembed ||
			oembed === 'error' ||
			!oembed.permalink
		) {
			return null;
		}
		let pathname: string;
		try {
			pathname = new URL(oembed.permalink).pathname;
		} catch {
			return null;
		}
		// embed_host_url is where the widget's links point back at; nullsrcdoc
		// is exactly what breaks the widget path, so give it the real origin.
		const origin = typeof window === 'undefined' ? '' : window.location.origin;
		const src =
			`https://embed.reddit.com${pathname}?embed=true&ref_source=embed` +
			(origin ? `&embed_host_url=${encodeURIComponent(origin)}` : '');
		return { src, height: oembed.height ?? 600 };
	});

	const card = $derived.by(() => {
		if (redditOembed?.title) {
			return {
				href,
				providerName: redditOembed.providerName,
				title: redditOembed.title,
				thumbnailUrl: redditOembed.thumbnailUrl,
				mediaHref: redditOembed.outbound ?? href
			} satisfies CardView;
		}

		if (
			!oembed ||
			oembed === 'error' ||
			(!oembedFrame && !oembed.title && !oembed.providerName && !oembed.thumbnailUrl)
		) {
			return null;
		}

		return {
			href,
			providerName: oembed.providerName,
			title: oembed.title,
			thumbnailUrl: oembed.thumbnailUrl,
			mediaHref: href
		} satisfies CardView;
	});

	const cardImage = $derived.by(() => {
		if (cachedCardImage && cachedCard) return cachedCardImage;
		if (spec.kind !== 'server-oembed' || !card || nativeSpec?.kind !== 'image') return null;
		return {
			href: card.mediaHref,
			src: nativeSpec.url,
			alt: label
		};
	});

	const iframeEmbed = $derived.by(() => {
		if (cachedIframeEmbed) return cachedIframeEmbed;
		if (card && spec.kind === 'server-oembed') {
			if (nativeSpec?.kind === 'iframe') {
				return {
					shellClass: 'card-media player iframe-shell',
					frameClass: null,
					src: nativeSpec.src,
					title: nativeSpec.title,
					height: null,
					allowFullscreen: true
				} satisfies IframeView;
			}

			if (redditFrame) {
				return {
					shellClass: 'card-media iframe-shell',
					frameClass: 'reddit-frame',
					src: redditFrame.src,
					title: redditOembed?.title ?? 'Reddit embed',
					height: redditFrame.height,
					allowFullscreen: false
				} satisfies IframeView;
			}

			if (oembedFrame) {
				return {
					shellClass: 'card-media player iframe-shell',
					frameClass: null,
					src: oembedFrame.src,
					title: oembedFrame.title,
					height: oembedFrame.height,
					allowFullscreen: true
				} satisfies IframeView;
			}

			return null;
		}

		if (spec.kind === 'iframe') {
			return {
				shellClass: 'embed player iframe-shell',
				frameClass: null,
				src: spec.src,
				title: spec.title,
				height: null,
				allowFullscreen: true
			} satisfies IframeView;
		}

		if (card && oembedFrame) {
			return {
				shellClass: 'card-media player iframe-shell',
				frameClass: null,
				src: oembedFrame.src,
				title: oembedFrame.title,
				height: oembedFrame.height,
				allowFullscreen: true
			} satisfies IframeView;
		}

		return null;
	});

	const standaloneImage = $derived.by(() => {
		if (cachedStandaloneImage) return cachedStandaloneImage;
		if (spec.kind !== 'image') return null;
		return {
			href,
			src: spec.url,
			alt: label
		};
	});

	const showFallbackLink = $derived.by(() => {
		if (cachedCard || cachedStandaloneImage || cachedIframeEmbed) return false;
		if (gateVisible || card || standaloneImage || iframeEmbed) return false;
		if (spec.kind === 'server-oembed') return true;
		if (oembed === undefined || oembed === 'error') return true;
		return !oembedFrame && !oembed.title;
	});

	let iframeLoading = $derived(iframeEmbed !== null);
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#if gateVisible}
	<!-- The gate. Rendering the reddit embed means asking our server to fetch
	     reddit for this URL, which hands the URL over — so nothing loads until
	     the viewer clicks. Once clicked, the gate stays put and the button turns
	     into a same-size loading state until an embed is actually ready, which
	     avoids the jump from button to card/iframe on a fast response. -->
	<span class="gate">
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a {href} target="_blank" rel="noopener noreferrer ugc">{label}</a>
		<button
			type="button"
			aria-label="Show"
			class:busy={waitingForRedditEmbed}
			aria-busy={waitingForRedditEmbed}
			disabled={waitingForRedditEmbed}
			onclick={reveal}
		>
			<span class:visually-hidden={waitingForRedditEmbed}>Show</span>
			{#if waitingForRedditEmbed}
				<span class="button-loading" aria-live="polite">
					<wa-spinner></wa-spinner>
				</span>
			{/if}
		</button>
	</span>
{:else if cachedCard || card}
	<span class="embed card-shell">
		{#if canRefresh}
			<button
				type="button"
				class="refresh"
				aria-label="Refresh preview"
				title="Refresh preview"
				aria-busy={refreshing}
				disabled={refreshing}
				onclick={refresh}
			>
				{#if refreshing}
					<wa-spinner></wa-spinner>
				{:else}
					<wa-icon name="arrows-rotate" variant="solid"></wa-icon>
				{/if}
			</button>
		{/if}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a
			class="card card-link"
			href={(cachedCard ?? card)?.href}
			target="_blank"
			rel="noopener noreferrer ugc"
		>
			<span class="meta">
				{#if (cachedCard ?? card)?.providerName}
					<span class="provider">{(cachedCard ?? card)?.providerName}</span>
				{/if}
				{#if (cachedCard ?? card)?.title}
					<span class="title">{(cachedCard ?? card)?.title}</span>
				{/if}
			</span>
			{#if (cachedCard ?? card)?.thumbnailUrl}
				<img
					src={(cachedCard ?? card)?.thumbnailUrl}
					alt=""
					loading="lazy"
					referrerpolicy="no-referrer"
				/>
			{/if}
		</a>
		{#if cardImage}
			<a
				class="card-media image"
				href={cardImage.href}
				target="_blank"
				rel="noopener noreferrer ugc"
			>
				<img src={cardImage.src} alt={cardImage.alt} loading="lazy" referrerpolicy="no-referrer" />
			</a>
		{:else if iframeEmbed}
			<!-- Same sandbox as the curated players: the reddit post pointed here, and
		     the gate already covered the privacy half. These iframes deliberately do
		     NOT set `referrerpolicy="no-referrer"`: Redgifs uses the embed origin as
		     part of its cross-origin checks, and a missing Referer silently leaves
		     the player blank. -->
			<span class={iframeEmbed.shellClass} aria-busy={iframeLoading}>
				{#if iframeLoading}
					<span class="loading-overlay" aria-live="polite">
						<wa-spinner></wa-spinner>
						<span>Loading embed…</span>
					</span>
				{/if}
				<iframe
					class={iframeEmbed.frameClass ?? undefined}
					src={iframeEmbed.src}
					title={iframeEmbed.title}
					height={iframeEmbed.height ?? undefined}
					allowfullscreen={iframeEmbed.allowFullscreen}
					loading="lazy"
					onload={() => (iframeLoading = false)}
					onerror={() => (iframeLoading = false)}
					sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
				></iframe>
			</span>
		{/if}
	</span>
{:else if showFallbackLink}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a {href} target="_blank" rel="noopener noreferrer ugc">{label}</a>
{:else if standaloneImage}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a class="embed image" href={standaloneImage.href} target="_blank" rel="noopener noreferrer ugc">
		<!-- alt from the visible label: the URL text is the only description
		     the sender gave us. -->
		<img
			src={standaloneImage.src}
			alt={standaloneImage.alt}
			loading="lazy"
			referrerpolicy="no-referrer"
		/>
	</a>
{:else if iframeEmbed}
	<!-- The sandbox grants exactly what a hosted video player needs to run,
	     and no top-level navigation: the embed can play, pop out and go
	     fullscreen, but it can never navigate this page away. -->
	<span class={iframeEmbed.shellClass} aria-busy={iframeLoading}>
		{#if iframeLoading}
			<span class="loading-overlay" aria-live="polite">
				<wa-spinner></wa-spinner>
				<span>Loading embed…</span>
			</span>
		{/if}
		<iframe
			class={iframeEmbed.frameClass ?? undefined}
			src={iframeEmbed.src}
			title={iframeEmbed.title}
			height={iframeEmbed.height ?? undefined}
			allowfullscreen={iframeEmbed.allowFullscreen}
			loading="lazy"
			onload={() => (iframeLoading = false)}
			onerror={() => (iframeLoading = false)}
			sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
		></iframe>
	</span>
{/if}

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.embed {
		display: block;
		margin-block: 0.25rem;
		border-radius: 0.5rem;
		overflow: hidden;
		color: inherit;
		white-space: initial;
	}

	.player iframe {
		width: 100%;
		aspect-ratio: 16 / 9;
		border: 0;
		display: block;
	}

	.iframe-shell {
		position: relative;
	}

	.loading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: rgb(0 0 0 / 45%);
		color: white;
		font-size: 0.8125rem;
		backdrop-filter: blur(2px);

		wa-spinner {
			font-size: 1rem;
		}
	}

	.image img {
		max-inline-size: 100%;
		max-block-size: 20rem;
		display: block;
	}

	.card-shell {
		display: block;
		position: relative;
		border: 1px solid rgb(0 0 0 / 10%);
		background: rgb(0 0 0 / 4%);
		color: inherit;

		img {
			max-inline-size: 100%;
			display: block;
		}
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.5rem;
		text-decoration: none;
		color: inherit;

		.meta {
			display: flex;
			flex-direction: column;
		}

		.provider {
			font-size: 0.75rem;
			opacity: 0.75;
		}
	}

	.card-link {
		display: flex;
		flex-direction: column;
		color: inherit;
	}

	.card-media {
		display: block;
		border-block-start: 1px solid rgb(0 0 0 / 10%);
	}

	.refresh {
		position: absolute;
		inset-block-start: 0.35rem;
		inset-inline-end: 0.35rem;
		z-index: 1;
		display: grid;
		place-items: center;
		font: inherit;
		font-size: 0.9rem;
		line-height: 1;
		padding: 0.2rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--wa-color-text-normal);
		cursor: pointer;

		wa-icon,
		wa-spinner {
			font-size: 0.95rem;
		}

		&:disabled {
			cursor: default;
			opacity: 0.7;
		}
	}

	.reddit-frame {
		display: block;
		width: 100%;
		border: 0;
	}

	.gate {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		vertical-align: baseline;

		button {
			position: relative;
			font: inherit;
			font-size: 0.9em;
			padding: 0 0.7em;
			line-height: 0.9lh;
			height: 1lh;
			border: 1px solid currentColor;
			border-radius: 999px;
			background: transparent;
			color: inherit;
			cursor: pointer;
			min-inline-size: 3.75rem;
			margin-inline-end: 0.1em;

			&.busy {
				cursor: pointer;
			}

			wa-spinner {
				font-size: 0.875rem;
			}
		}
	}

	.button-loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.visually-hidden {
		visibility: hidden;
	}
</style>
