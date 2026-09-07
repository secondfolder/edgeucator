<script lang="ts">
	import { fetchAttachment } from '$lib/messaging/client';
	import type { MessageAttachmentInfo } from '$lib/crypto/messages';

	/**
	 * One decrypted image or video.
	 *
	 * Downloaded in full and decrypted before anything can be shown, because age
	 * ciphertext is not seekable — there is no `Range` support and no
	 * progressive playback. That is why videos are capped below the message
	 * budget, and why this shows a spinner rather than a progress bar (a plain
	 * `fetch` reports no download progress).
	 */
	let {
		info,
		partnershipId
	}: {
		info: MessageAttachmentInfo;
		partnershipId: string;
	} = $props();

	let url: string | null = $state(null);
	let failed = $state(false);

	$effect(() => {
		let current: string | null = null;
		let cancelled = false;

		void (async () => {
			try {
				const result = await fetchAttachment(partnershipId, info);
				if (cancelled) {
					// Revoked immediately: the component went away mid-download, and
					// an un-revoked object URL keeps the whole decrypted blob in memory.
					URL.revokeObjectURL(result.url);
					return;
				}
				current = result.url;
				url = result.url;
			} catch (error) {
				console.error('could not open attachment', error);
				if (!cancelled) failed = true;
			}
		})();

		return () => {
			cancelled = true;
			if (current) URL.revokeObjectURL(current);
		};
	});
</script>

{#if failed}
	<p class="failed">Could not open this file.</p>
{:else if !url}
	<div class="loading" aria-live="polite">
		<wa-spinner></wa-spinner>
		<span>Decrypting {info.fileName}…</span>
	</div>
{:else if info.kind === 'video'}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video src={url} controls playsinline preload="metadata"></video>
{:else}
	<img src={url} alt={info.fileName} />
{/if}

<style>
	img,
	video {
		display: block;
		max-inline-size: 100%;
		max-block-size: 22rem;
		border-radius: var(--wa-panel-border-radius, 0.5rem);
	}

	.loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8125rem;
		color: var(--wa-color-text-quiet);

		wa-spinner {
			font-size: 1rem;
		}
	}

	.failed {
		margin: 0;
		font-size: 0.8125rem;
		color: var(--wa-color-text-danger);
	}
</style>
