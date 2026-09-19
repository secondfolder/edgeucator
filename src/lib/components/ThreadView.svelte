<script lang="ts">
	import { untrack } from 'svelte';
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { invalidate } from '$app/navigation';
	import {
		EMBED_AUTO_LOAD_PROMPT_THRESHOLD,
		embedAutoLoadPromptCountStorageKey,
		readLocalEmbedAutoLoadPreference,
		writeLocalEmbedAutoLoadPreference
	} from '$lib/embed-autoload';
	import { scrollIntoViewWithin } from '$lib/scroll-parent';
	import { currentKeyring } from '$lib/crypto/session.svelte';
	import {
		buildReaction,
		fillMissingMessageMetadata,
		openMessage,
		openMessageMetadata,
		openReaction,
		refreshMessageMetadata,
		saveEmbedAutoLoadPreference,
		sendMessage
	} from '$lib/messaging/client';
	import type { MessageMetadataPayload, MessagePayload } from '$lib/crypto/messages';
	import type { MessageView, PartnerRecipientsView, TagView, ThreadView } from '$lib/types';
	import MessageBubble from './MessageBubble.svelte';
	import MessageComposer from './MessageComposer.svelte';
	// LEGACY-RICHTEXT — delete with the legacy reader; see docs/temporary-code.md
	import { migrateLegacyMessages } from '$lib/richtext-legacy-migrate';
	import TagPicker from './TagPicker.svelte';

	let {
		thread,
		partnershipId,
		userId,
		embedAutoLoad = null,
		tags = [],
		recipients,
		/**
		 * False while this device distrusts one of the two keys.
		 *
		 * The reply box is removed rather than disabled: the reason is a callout
		 * on the board, and an inert textarea with no explanation next to it
		 * reads as a bug. Passed in rather than derived here so the board and
		 * the thread cannot disagree about it.
		 */
		canSend = true
	}: {
		thread: ThreadView;
		partnershipId: string;
		userId: string;
		embedAutoLoad?: boolean | null;
		tags?: TagView[];
		recipients: PartnerRecipientsView;
		canSend?: boolean;
	} = $props();

	const keyring = $derived(currentKeyring());
	// Selection is the live control state; re-deriving it on every thread refresh
	// would undo a tag click while the assignment request is in flight.
	// svelte-ignore state_referenced_locally
	let selectedTagIds = $state(thread.tags?.map((tag) => tag.id) ?? []);

	/**
	 * Decrypted bodies, by message id.
	 *
	 * `undefined` means "still working", `null` means "this identity cannot open
	 * it" — a real state, not an error, for a message sent to a key the user
	 * replaced. `MessageBubble` renders the three cases differently.
	 */
	let bodies: Record<string, MessagePayload | null> = $state({});
	let metadata: Record<string, MessageMetadataPayload | null> = $state({});
	let reactions: Record<string, { emoji: string; mine: boolean }[]> = $state({});
	let listElement: HTMLElement | undefined = $state();
	// svelte-ignore state_referenced_locally
	// Captures the served preference once so the prompt flow can flip this local
	// state immediately without waiting for a reload.
	let embedAutoLoadPreference = $state<boolean | null>(
		readLocalEmbedAutoLoadPreference(userId) ?? embedAutoLoad
	);
	let showEmbedAutoLoadPrompt = $state(false);
	let savingEmbedAutoLoad = $state(false);
	let embedAutoLoadProblem = $state<string | null>(null);
	const attemptedMetadataBackfill = new SvelteSet<string>();

	$effect(() => {
		const local = readLocalEmbedAutoLoadPreference(userId);
		embedAutoLoadPreference = local ?? embedAutoLoad;
	});

	$effect(() => {
		const unlocked = keyring.status === 'unlocked' ? keyring.identity : null;
		if (!unlocked) return;

		// Captured so a run superseded by a newer one bails out rather than
		// writing stale plaintext over fresh — the same guard EdgeTask.svelte uses.
		const messages = thread.messages;
		let cancelled = false;

		void (async () => {
			for (const message of messages) {
				if (cancelled) return;
				if (!(message.id in bodies)) {
					bodies[message.id] = await openMessage(message.ciphertext, unlocked);
				}
				if (message.metadataCiphertext !== null && !(message.id in metadata)) {
					metadata[message.id] = await openMessageMetadata(message.metadataCiphertext, unlocked);
				}
				const decoded: { emoji: string; mine: boolean }[] = [];
				for (const reaction of message.reactions) {
					const emoji = await openReaction(reaction.ciphertext, unlocked);
					if (emoji) decoded.push({ emoji, mine: reaction.mine });
				}
				if (cancelled) return;
				reactions[message.id] = decoded;
			}

			// LEGACY-RICHTEXT — once everything on screen is readable, quietly
			// convert and re-save any of the viewer's own pre-rich-text bodies.
			// Runs last and its failures are swallowed: this is housekeeping, and
			// it must never get in the way of reading a thread. See
			// docs/temporary-code.md.
			if (cancelled) return;
			// `bodies` and `targets` are read through `untrack` on purpose. Both
			// are reactive, and this effect already *writes* `bodies`; making it
			// depend on them as well would rebuild the whole decryption pass on
			// every change — the same class of bug AGENTS.md records for effects
			// that read the `data` prop.
			const entries = untrack(() =>
				messages
					.filter((message) => message.mine && message.bodyFormat === 'plain')
					.map((message) => ({ id: message.id, payload: bodies[message.id] }))
			);
			await migrateLegacyMessages({
				partnershipId,
				entries,
				targets: untrack(() => targets)
			});
		})();

		return () => {
			cancelled = true;
		};
	});

	// Keeps the newest message in view. Goes through the shared scroll helper
	// because `<main>` is the only scrolling element in this shell — the window
	// does not scroll, so window.scrollTo would move nothing.
	$effect(() => {
		const count = thread.messages.length;
		void tick().then(() => {
			if (!listElement || count !== thread.messages.length) return;
			const last = listElement.lastElementChild;
			if (last) scrollIntoViewWithin(last, listElement, { behavior: 'auto', gap: 8 });
		});
	});

	const targets = $derived(
		[recipients.mine, recipients.theirs].filter((value): value is string => value !== null)
	);

	function formatWhen(date: Date): string {
		return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
	}

	async function send(message: { text: string; files: File[] }): Promise<string | null> {
		const outcome = await sendMessage(
			{ kind: 'reply', partnershipId, threadId: thread.id },
			message,
			targets
		);
		if (!outcome.ok) return outcome.message;
		await invalidate(`messages:thread:${thread.id}`);
		return null;
	}

	async function react(message: MessageView, emoji: string) {
		const ciphertext = await buildReaction(emoji, targets);
		const response = await fetch(
			`/api/partnerships/${partnershipId}/messages/${message.id}/reaction`,
			{
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ciphertext })
			}
		);
		if (response.ok) await invalidate(`messages:thread:${thread.id}`);
	}

	async function clearReaction(message: MessageView) {
		const response = await fetch(
			`/api/partnerships/${partnershipId}/messages/${message.id}/reaction`,
			{ method: 'DELETE' }
		);
		if (response.ok) await invalidate(`messages:thread:${thread.id}`);
	}

	async function revealEmbed(message: MessageView, href: string) {
		if (targets.length === 0) return;
		const key = `${message.id}:${href}`;
		if (attemptedMetadataBackfill.has(key)) return;
		attemptedMetadataBackfill.add(key);
		const current = metadata[message.id] ?? null;
		const next = await fillMissingMessageMetadata(
			partnershipId,
			message.id,
			href,
			current,
			targets
		);
		if (next) metadata[message.id] = next;
		if (embedAutoLoadPreference === null) maybePromptForEmbedAutoLoad();
	}

	async function refreshEmbed(message: MessageView, href: string) {
		if (targets.length === 0) return;
		const current = metadata[message.id] ?? null;
		const next = await refreshMessageMetadata(partnershipId, message.id, href, current, targets);
		if (next) metadata[message.id] = next;
	}

	function maybePromptForEmbedAutoLoad() {
		if (typeof window === 'undefined' || embedAutoLoadPreference !== null) return;
		const key = embedAutoLoadPromptCountStorageKey(userId);
		const raw = window.localStorage.getItem(key);
		const current = Number.parseInt(raw ?? '0', 10);
		const next = Number.isFinite(current) ? current + 1 : 1;
		window.localStorage.setItem(key, String(next));
		if (next >= EMBED_AUTO_LOAD_PROMPT_THRESHOLD) {
			embedAutoLoadProblem = null;
			showEmbedAutoLoadPrompt = true;
		}
	}

	async function chooseEmbedAutoLoad(enabled: boolean) {
		savingEmbedAutoLoad = true;
		embedAutoLoadProblem = null;
		try {
			writeLocalEmbedAutoLoadPreference(userId, enabled);
			const saved = await saveEmbedAutoLoadPreference(enabled);
			if (!saved) {
				embedAutoLoadProblem = 'Could not save that preference';
				return;
			}
			embedAutoLoadPreference = enabled;
			showEmbedAutoLoadPrompt = false;
			if (typeof window !== 'undefined') {
				window.localStorage.setItem(
					embedAutoLoadPromptCountStorageKey(userId),
					String(EMBED_AUTO_LOAD_PROMPT_THRESHOLD)
				);
			}
		} finally {
			savingEmbedAutoLoad = false;
		}
	}
</script>

<div class="thread">
	<div class="thread-tags">
		<TagPicker {partnershipId} {tags} threadId={thread.id} bind:selectedIds={selectedTagIds} />
	</div>
	<ul bind:this={listElement} class="messages">
		{#each thread.messages as message (message.id)}
			<MessageBubble
				{message}
				payload={message.id in bodies ? bodies[message.id] : undefined}
				metadata={message.id in metadata ? metadata[message.id] : undefined}
				autoLoadEmbeds={embedAutoLoadPreference === true}
				onRevealEmbed={(href) => revealEmbed(message, href)}
				onRefreshEmbed={(href) => refreshEmbed(message, href)}
				{partnershipId}
				when={formatWhen(message.createdAt)}
				reactions={reactions[message.id] ?? []}
				onReact={(emoji) => react(message, emoji)}
				onClearReaction={() => clearReaction(message)}
			/>
		{/each}
	</ul>

	{#if showEmbedAutoLoadPrompt}
		<wa-dialog class="embed-auto-load-dialog" label="Show embeds automatically" open>
			<div class="prompt-body">
				<p>
					Showing URL embeds sends the linked URL to Bound Up's servers so they can resolve the
					preview or player. Those lookups are never logged.
				</p>
				<p class="quiet">You can change this later in Encrypted messages.</p>
				<div class="prompt-actions">
					<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
					<wa-button
						type="button"
						appearance="outlined"
						disabled={savingEmbedAutoLoad}
						onclick={() => chooseEmbedAutoLoad(false)}
					>
						No, keep Show buttons
					</wa-button>
					<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
					<wa-button
						type="button"
						variant="brand"
						disabled={savingEmbedAutoLoad}
						onclick={() => chooseEmbedAutoLoad(true)}
					>
						Yes, load automatically
					</wa-button>
				</div>
				{#if embedAutoLoadProblem}
					<span class="invalid">{embedAutoLoadProblem}</span>
				{/if}
			</div>
		</wa-dialog>
	{/if}

	<!--
		`position: sticky; bottom: 0` INSIDE the scrolling <main> pins this to the
		bottom of the scrollport, directly above AppNav. Sticky against the
		viewport does not work in this shell and teleporting to <body> does not
		either, because <body> does not scroll — EdgeTask.svelte's footer is the
		working precedent, gradient fade included.
	-->
	{#if canSend}
		<footer>
			<MessageComposer {send} placeholder="Reply…" />
		</footer>
	{/if}
</div>

<style>
	.thread {
		display: flex;
		flex-direction: column;
		/* flex, not min-height: 100% — the shell only sets min-height on the page
		   wrapper, so a percentage height has no specified ancestor to resolve
		   against. */
		flex: 1 1 auto;
		min-block-size: 0;
	}

	.messages {
		list-style: none;
		margin: 0;
		padding: var(--wa-space-m);
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		flex: 1 1 auto;
	}

	.thread-tags {
		padding: var(--wa-space-s) var(--wa-space-m) 0;
	}

	footer {
		position: sticky;
		inset-block-end: 0;
		padding: var(--wa-space-s) var(--wa-space-m) var(--wa-space-m);
		/* So bubbles scrolling under the composer stay legible on the way past. */
		background: linear-gradient(
			to bottom,
			transparent,
			var(--wa-color-surface-default, white) 0.75rem
		);
	}

	wa-dialog.embed-auto-load-dialog {
		--width: min(28rem, calc(100vw - 2rem));
	}

	.prompt-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;

		p {
			margin: 0;
		}
	}

	.prompt-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.quiet,
	.invalid {
		font-size: 0.875rem;
	}

	.quiet {
		color: var(--wa-color-text-quiet);
	}

	.invalid {
		color: var(--wa-color-text-danger);
	}
</style>
