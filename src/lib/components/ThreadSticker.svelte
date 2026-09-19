<script lang="ts">
	import { documentToPlainText, parseStoredRichText } from '$lib/richtext';
	import { resolve } from '$app/paths';
	import type {
		MessageAttachmentInfo,
		MessageMetadataPayload,
		MessagePayload
	} from '$lib/crypto/messages';
	import { currentKeyring } from '$lib/crypto/session.svelte';
	import { fetchAttachment, openMessage, openMessageMetadata } from '$lib/messaging/client';
	import type { ThreadStickerView } from '$lib/types';

	type PreviewMedia = {
		id: string;
		kind: MessageAttachmentInfo['kind'];
		url: string;
	};

	type FanCard =
		| { id: string; kind: 'media'; mediaKind: MessageAttachmentInfo['kind']; url: string }
		| { id: 'text'; kind: 'text'; text: string };
	const MAX_PREVIEW_ITEMS = 4;

	/**
	 * One thread, as a tile on the board.
	 *
	 * The board used to jitter these around like paper stickers. That looked fun
	 * until the previews arrived: text plus timestamps want a stable grid, not a
	 * novelty transform that makes every row feel slightly off.
	 */
	let {
		thread,
		partnershipId,
		/** 1-based, for the accessible name. Two stickers can share a timestamp. */
		position,
		total
	}: {
		thread: ThreadStickerView;
		partnershipId: string;
		position: number;
		total: number;
	} = $props();

	const href = $derived(
		resolve('/(auth-required)/(app)/partner/[id]/messages/[threadId]', {
			id: partnershipId,
			threadId: thread.id
		})
	);
	const keyring = $derived(currentKeyring());
	const sealed = $derived(thread.unread && thread.lastFullyReadAt === null);
	let preview: MessagePayload | null | undefined = $state(undefined);
	let previewMetadata = $state<MessageMetadataPayload | null | undefined>(undefined);
	let mediaPreviews: PreviewMedia[] = $state([]);
	let mediaLoading = $state(false);

	$effect(() => {
		if (sealed) return;
		if (keyring.status !== 'unlocked') return;

		let cancelled = false;
		preview = undefined;
		void openMessage(thread.previewCiphertext, keyring.identity).then((payload) => {
			if (!cancelled) preview = payload;
		});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (sealed) return;
		if (keyring.status !== 'unlocked') return;
		if (thread.previewMetadataCiphertext === null) {
			previewMetadata = null;
			return;
		}

		let cancelled = false;
		previewMetadata = undefined;
		void openMessageMetadata(thread.previewMetadataCiphertext, keyring.identity).then((payload) => {
			if (!cancelled) previewMetadata = payload;
		});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const payload = preview;
		mediaPreviews = [];
		mediaLoading = false;

		if (!payload || payload.attachments.length === 0) {
			return;
		}

		const attachments = previewAttachments(payload);
		let cancelled = false;
		let current: string[] = [];
		mediaLoading = true;

		void Promise.all(
			attachments.map(async (info) => {
				const result = await fetchAttachment(partnershipId, info);
				return { id: info.id, kind: info.kind, url: result.url } satisfies PreviewMedia;
			})
		)
			.then((results) => {
				if (cancelled) {
					for (const result of results) URL.revokeObjectURL(result.url);
					return;
				}
				current = results.map((result) => result.url);
				mediaPreviews = results;
				mediaLoading = false;
			})
			.catch(() => {
				if (!cancelled) {
					mediaPreviews = [];
					mediaLoading = false;
				}
			});

		return () => {
			cancelled = true;
			for (const url of current) URL.revokeObjectURL(url);
		};
	});

	function sameDay(a: Date, b: Date): boolean {
		return (
			a.getFullYear() === b.getFullYear() &&
			a.getMonth() === b.getMonth() &&
			a.getDate() === b.getDate()
		);
	}

	function formatSent(date: Date): string {
		return new Intl.DateTimeFormat(
			undefined,
			sameDay(date, new Date()) ? { hour: 'numeric', minute: '2-digit' } : { dateStyle: 'medium' }
		).format(date);
	}

	function formatOpened(date: Date): string {
		return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
	}

	/**
	 * A sticker preview is a few lines of prose, so it shows the message's
	 * *visible text* rather than the stored document — otherwise the board would
	 * be a wall of raw JSON. Formatting is dropped rather than rendered: this is
	 * a thumbnail, and a bolded first word in a four-line clamp is noise.
	 */
	function previewText(payload: MessagePayload): string {
		return documentToPlainText(parseStoredRichText(payload.text));
	}

	function loadedPreview(value: MessagePayload | null | undefined): MessagePayload | null {
		return value ?? null;
	}

	function previewAttachments(payload: MessagePayload): MessageAttachmentInfo[] {
		const availableSlots = MAX_PREVIEW_ITEMS - Number(Boolean(previewText(payload)));
		return payload.attachments.slice(0, availableSlots);
	}

	function fanOffset(index: number, count: number): number {
		if (count <= 1) return 0;
		return (index / (count - 1) - 0.5) * 2;
	}

	function fanWidth(count: number): string {
		const width = 76 - (count - 1) * 9;
		return `${Math.max(42, Math.min(72, width))}%`;
	}

	function fanWidthValue(count: number): number {
		const width = 76 - (count - 1) * 9;
		return Math.max(42, Math.min(72, width));
	}

	function fanSpread(count: number): string {
		const width = fanWidthValue(count);
		const target = count <= 2 ? 92 : Math.max(94, 106 - count * 3);
		return `${Math.max(10, (target - width) / 2)}%`;
	}

	function fanHoverSpread(count: number): string {
		const width = fanWidthValue(count);
		const target = 140;
		return `${Math.max(16, (target - width) / 2)}%`;
	}

	function fanTilt(index: number, count: number): number {
		return Math.round(fanOffset(index, count) * 8);
	}

	function fanZ(index: number, count: number): number {
		return count - index;
	}

	const when = $derived(formatSent(thread.lastMessageAt));
	const opened = $derived(
		!thread.unread &&
			thread.lastFullyReadAt &&
			!sameDay(thread.lastFullyReadAt, thread.lastMessageAt)
			? `opened ${formatOpened(thread.lastFullyReadAt)}`
			: null
	);

	// Two links must not share an accessible name (AGENTS.md), and on a board of
	// similar previews the only distinguishing facts are the position and the
	// timing — so both go in.
	const label = $derived(
		`${thread.unread ? 'Unread message' : 'Message'} ${position} of ${total}, ${when}` +
			(opened ? `, ${opened}` : '') +
			(thread.messageCount > 1 ? `, ${thread.messageCount} messages` : '')
	);
	const previewValue = $derived(loadedPreview(preview));
	const embedPreview = $derived(previewMetadata?.embeds[0] ?? null);
	const embedThumbnail = $derived(embedPreview?.thumbnailUrl ?? embedPreview?.imageUrl ?? null);
	const textPreview = $derived(previewValue ? previewText(previewValue) : '');
	const hasTextPreview = $derived(Boolean(textPreview));
	const previewItemCount = $derived(
		previewValue ? previewAttachments(previewValue).length + (textPreview ? 1 : 0) : 0
	);
	const singlePreview = $derived(previewItemCount === 1);
	const showFan = $derived(previewItemCount > 1);
	const fanCards = $derived([
		...mediaPreviews.map(
			(media) => ({ id: media.id, kind: 'media', mediaKind: media.kind, url: media.url }) as const
		),
		...(textPreview ? ([{ id: 'text', kind: 'text', text: textPreview }] as const) : [])
	] satisfies FanCard[]);
</script>

<li>
	<a {href} class:unread={thread.unread} class:sealed aria-label={label}>
		<div class="card">
			{#if sealed}
				<div class="preview preview-envelope" aria-hidden="true">
					<wa-icon name="envelope" variant="solid" canvas="square"></wa-icon>
				</div>
			{:else}
				<div
					class:preview-single={singlePreview}
					class:preview-text={hasTextPreview && !showFan}
					class:preview-media={Boolean(mediaPreviews.length) && !showFan}
					class:preview-fan={showFan}
					class="preview"
					data-state={preview === undefined ? 'pending' : preview === null ? 'missing' : 'ready'}
				>
					{#if preview === undefined}
						<span class="pending" aria-label="Decrypting">···</span>
					{:else if embedPreview}
						<div class:with-thumbnail={Boolean(embedThumbnail)} class="embed-preview">
							{#if embedThumbnail}
								<img class="embed-thumb" src={embedThumbnail} alt="" />
							{/if}
							<div class="embed-copy">
								{#if embedPreview.providerName}
									<span class="provider">{embedPreview.providerName}</span>
								{/if}
								{#if embedPreview.title}
									<p class="title">{embedPreview.title}</p>
								{:else}
									<p class="title">Link preview</p>
								{/if}
							</div>
						</div>
					{:else if preview === null}
						<p class="unreadable">Restore needed to read this preview.</p>
					{:else if showFan}
						<div
							class="fan"
							style={`--fan-count: ${previewItemCount}; --fan-base-gap: ${fanSpread(previewItemCount)}; --fan-hover-gap: ${fanHoverSpread(previewItemCount)}; --fan-card-width: ${fanWidth(previewItemCount)};`}
						>
							{#each fanCards as card, index (card.id)}
								<div
									class:media-card={card.kind === 'media'}
									class:text-bubble={card.kind === 'text'}
									class="fan-card"
									style={`--fan-offset: ${fanOffset(index, previewItemCount)}; --fan-tilt: ${fanTilt(index, previewItemCount)}deg; --fan-z: ${fanZ(index, previewItemCount)};`}
								>
									{#if card.kind === 'media' && card.mediaKind === 'video'}
										<video class="thumb" src={card.url} muted playsinline preload="metadata"
										></video>
									{:else if card.kind === 'media'}
										<img class="thumb" src={card.url} alt="" />
									{:else}
										<p class="text">{card.text}</p>
									{/if}
								</div>
							{/each}
							{#if mediaLoading && mediaPreviews.length === 0 && !hasTextPreview}
								<span class="pending" aria-label="Decrypting">···</span>
							{/if}
						</div>
					{:else if mediaPreviews[0]?.kind === 'video'}
						<video class="thumb" src={mediaPreviews[0].url} muted playsinline preload="metadata"
						></video>
					{:else if mediaPreviews[0]}
						<img class="thumb" src={mediaPreviews[0].url} alt="" />
					{:else}
						<div class="single-card text-bubble"><p class="text">{previewText(preview)}</p></div>
					{/if}
				</div>
			{/if}

			<div class="meta">
				<span>{when}</span>
				{#if opened}<span>{opened}</span>{/if}
			</div>

			{#if thread.tags?.length}
				<div class="tags" aria-label="Tags">
					{#each thread.tags as tag (tag.id)}
						<span class="tag" style={`--tag-color: ${tag.color}`}>{tag.name}</span>
					{/each}
				</div>
			{/if}

			{#if thread.unread && thread.lastFullyReadAt !== null}
				<span class="dot" aria-hidden="true"></span>
			{/if}
		</div>
	</a>
</li>

<style>
	li {
		position: relative;
	}

	a {
		position: relative;
		display: block;
		text-decoration: none;
		color: var(--wa-color-text-quiet);
		/* Kills the grey flash on tap that makes a web app feel non-native. */
		-webkit-tap-highlight-color: transparent;

		&:hover,
		&:focus-visible {
			.card {
				transform: translateY(-0.125rem);
				box-shadow: 0 0.8rem 1.6rem rgb(0 0 0 / 12%);
			}
		}

		.card {
			position: relative;
			display: flex;
			flex-direction: column;
			justify-content: space-between;
			gap: 0.5rem;
			min-block-size: 8rem;
			padding: 0.7rem;
			border-radius: 1rem;
			background: var(--wa-color-surface-default, white);
			box-shadow: 0 0.4rem 1rem rgb(0 0 0 / 8%);
			transition:
				transform var(--wa-transition-fast, 100ms) ease,
				box-shadow var(--wa-transition-fast, 100ms) ease;
		}

		.preview {
			block-size: 4.75rem;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 0.25rem;
			border-radius: 0.8rem;
			background: color-mix(
				in srgb,
				var(--wa-color-brand-fill-quiet, var(--wa-color-surface-raised, currentColor)) 18%,
				var(--wa-color-surface-raised, var(--wa-color-surface-default, white))
			);

			&[data-state='ready'] {
				align-items: flex-start;
				justify-content: flex-start;
			}

			&.preview-text {
				align-items: center;
				justify-content: center;
				padding: 0.75rem;
				text-align: center;
			}

			&.preview-single {
				padding: 0;
				background: transparent;
			}

			&.preview-media {
				padding: 0;
				overflow: hidden;
			}

			&.preview-fan {
				padding: 0;
				align-items: center;
				justify-content: center;
				background: transparent;
			}
		}

		.preview-envelope {
			padding: 0;
			background: transparent;
		}

		.preview-envelope wa-icon {
			display: grid;
			place-items: center;
			inline-size: 100%;
			min-block-size: 100%;
			font-size: clamp(3.5rem, 14vw, 5.5rem);
			line-height: 1;
		}

		.text,
		.unreadable,
		.pending {
			margin: 0;
			font-size: 0.7rem;
			line-height: 1.3;
		}

		.text {
			white-space: pre-line;
			overflow: hidden;
			display: -webkit-box;
			line-clamp: 4;
			-webkit-line-clamp: 4;
			-webkit-box-orient: vertical;
			color: var(--wa-color-text-normal);
		}

		.fan {
			position: relative;
			inline-size: 100%;
			block-size: 4.75rem;
			--fan-base-gap: 18%;
			--fan-hover-gap: 26%;
			--fan-card-width: 58%;
		}

		.fan-card {
			position: absolute;
			inset-block-start: 50%;
			inset-inline-start: calc(50% + (var(--fan-offset) * var(--fan-base-gap)));
			inline-size: var(--fan-card-width);
			block-size: 4rem;
			transform: translate(-50%, -50%) translateY(calc(var(--fan-z) * 0.05rem))
				rotate(var(--fan-tilt));
			border-radius: 0.8rem;
			overflow: hidden;
			box-shadow: 0 0.4rem 1rem rgb(0 0 0 / 12%);
			background: var(--wa-color-surface-default, white);
			border: 1px solid color-mix(in srgb, var(--wa-color-surface-border) 85%, transparent);
			z-index: var(--fan-z);
			transition:
				inset-inline-start var(--wa-transition-normal, 200ms) ease,
				transform var(--wa-transition-normal, 200ms) ease;
		}

		.fan:hover .fan-card {
			inset-inline-start: calc(50% + (var(--fan-offset) * var(--fan-hover-gap)));
			transform: translate(-50%, -50%) translateY(calc(var(--fan-z) * 0.05rem))
				rotate(var(--fan-tilt));
		}

		.single-card {
			display: grid;
			place-items: center;
			inline-size: 100%;
			block-size: 100%;
			padding: 0.75rem;
			border-radius: 0.8rem;
			background: var(--wa-color-surface-default, white);
			border: 1px solid color-mix(in srgb, var(--wa-color-surface-border) 85%, transparent);
			text-align: center;
		}

		.text-bubble {
			display: grid;
			place-items: center;
			padding: 0.6rem;
			text-align: center;

			.text {
				inline-size: 100%;
			}
		}

		.media-card {
			background: var(--wa-color-surface-raised, var(--wa-color-surface-default, white));
		}

		.thumb {
			display: block;
			inline-size: 100%;
			block-size: 100%;
			object-fit: cover;
		}

		.pending,
		.unreadable {
			color: var(--wa-color-text-quiet);
		}

		.embed-preview {
			display: flex;
			align-items: stretch;
			inline-size: 100%;
			block-size: 100%;
			border-radius: 0.8rem;
			overflow: hidden;
			background: var(--wa-color-surface-default, white);
			border: 1px solid color-mix(in srgb, var(--wa-color-surface-border) 85%, transparent);

			&.with-thumbnail .embed-copy {
				justify-content: flex-start;
			}
		}

		.embed-thumb {
			inline-size: 42%;
			block-size: 100%;
			object-fit: cover;
			flex: 0 0 auto;
		}

		.embed-copy {
			display: flex;
			flex-direction: column;
			justify-content: center;
			gap: 0.2rem;
			padding: 0.55rem 0.65rem;
			min-inline-size: 0;
			text-align: left;
		}

		.provider,
		.title {
			margin: 0;
			overflow: hidden;
			display: -webkit-box;
			-webkit-box-orient: vertical;
		}

		.provider {
			font-size: 0.63rem;
			line-clamp: 1;
			-webkit-line-clamp: 1;
			color: var(--wa-color-text-quiet);
		}

		.title {
			font-size: 0.73rem;
			line-height: 1.25;
			line-clamp: 3;
			-webkit-line-clamp: 3;
			color: var(--wa-color-text-normal);
		}

		.meta {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.15rem;
			font-size: 0.68rem;
			line-height: 1.3;
			text-align: center;
		}

		.tags {
			display: flex;
			flex-wrap: wrap;
			justify-content: center;
			gap: 0.25rem;
		}

		.tag {
			padding: 0.15rem 0.4rem;
			border-radius: 999px;
			background: color-mix(in srgb, var(--tag-color) 18%, var(--wa-color-surface-default, white));
			border: 1px solid color-mix(in srgb, var(--tag-color) 55%, transparent);
			color: var(--wa-color-text-normal, #17202a);
			font-size: 0.65rem;
			line-height: 1.2;
			overflow-wrap: anywhere;
		}

		&.unread {
			color: var(--wa-color-brand-fill-loud, var(--wa-color-text-link));

			.card {
				box-shadow: 0 0.6rem 1.25rem rgb(0 0 0 / 10%);
			}
		}

		.dot {
			position: absolute;
			inset-block-start: 0.45rem;
			inset-inline-end: 0.45rem;
			inline-size: 0.6rem;
			block-size: 0.6rem;
			border-radius: 50%;
			background: var(--wa-color-brand-fill-loud, currentColor);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		a:hover,
		a:focus-visible {
			.card {
				transform: none;
			}
		}

		.card {
			transition: none;
		}
	}
</style>
