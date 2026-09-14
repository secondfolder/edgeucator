<script lang="ts" module>
	type T = Record<string, unknown>;
</script>

<script lang="ts" generics="T extends Record<string, unknown>">
	import { formFieldProxy, type FormPathLeaves, type SuperForm } from 'sveltekit-superforms';
	import { searchTimeZones } from '$lib/timezone';

	let {
		superform,
		field,
		deviceTimezone = null,
		title = 'Timezone'
	}: {
		superform: SuperForm<T>;
		field: FormPathLeaves<T>;
		deviceTimezone?: string | null;
		title?: string;
	} = $props();

	// svelte-ignore state_referenced_locally
	// Captures the initial `superform`/`field` on purpose: the proxies it
	// return are the live stores, so re-deriving them per render would rebuild
	// the field subscription instead.
	const { value, errors } = formFieldProxy(superform, field);
	const listId = 'timezone-options';
	const inputId = 'timezone-search';

	let root: HTMLDivElement | null = $state(null);
	let open = $state(false);
	let highlightedIndex = $state(0);
	let searching = $state(false);
	let searchValue = $state('');
	let searchPlaceholder = $state('Search for a timezone');

	const committedValue = $derived($value == null ? '' : String($value));
	const displayValue = $derived(searching ? searchValue : committedValue);
	const showDeviceTimezoneAction = $derived(
		Boolean(deviceTimezone && committedValue !== deviceTimezone)
	);
	const visibleOptions = $derived(searchTimeZones(searching ? searchValue : committedValue));

	$effect(() => {
		if (visibleOptions.length === 0) {
			highlightedIndex = 0;
			return;
		}

		if (highlightedIndex >= visibleOptions.length) {
			highlightedIndex = visibleOptions.length - 1;
		}
	});

	function showOptions() {
		open = true;
	}

	function hideOptions() {
		open = false;
	}

	function onInput(event: Event) {
		const target = event.target as HTMLInputElement | null;
		if (!searching) {
			searching = true;
			if (committedValue.length > 0) searchPlaceholder = committedValue;
		}
		searchValue = target?.value ?? '';
		highlightedIndex = 0;
		showOptions();
	}

	function onFocus() {
		showOptions();
	}

	function beginSearch() {
		if (searching) return;
		if (committedValue.length > 0) searchPlaceholder = committedValue;
		searchValue = '';
		searching = true;
		highlightedIndex = 0;
		showOptions();
	}

	function onBlur() {
		queueMicrotask(() => {
			if (root?.contains(document.activeElement)) return;

			if (searching) {
				searching = false;
				searchValue = '';
			}
			searchPlaceholder = 'Search for a timezone';
			hideOptions();
		});
	}

	function select(timezone: string) {
		$value = timezone as typeof $value;
		searching = false;
		searchValue = '';
		searchPlaceholder = 'Search for a timezone';
		hideOptions();
	}

	function useDeviceTimezone() {
		if (!deviceTimezone) return;
		$value = deviceTimezone as typeof $value;
		searching = false;
		searchValue = '';
		searchPlaceholder = 'Search for a timezone';
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			hideOptions();
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			showOptions();
			if (visibleOptions.length > 0) {
				highlightedIndex = (highlightedIndex + 1) % visibleOptions.length;
			}
			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			showOptions();
			if (visibleOptions.length > 0) {
				highlightedIndex =
					highlightedIndex === 0 ? visibleOptions.length - 1 : highlightedIndex - 1;
			}
			return;
		}

		if (event.key === 'Enter' && open && visibleOptions.length > 0) {
			event.preventDefault();
			select(visibleOptions[highlightedIndex] ?? visibleOptions[0]);
		}
	}
</script>

<div class="field" bind:this={root}>
	<label for={inputId}>{title}</label>
	<div class="row">
		<div class="picker">
			<input
				id={inputId}
				role="combobox"
				aria-autocomplete="list"
				aria-controls={listId}
				aria-expanded={open ? 'true' : 'false'}
				aria-invalid={$errors ? 'true' : undefined}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
				placeholder={searchPlaceholder}
				value={displayValue}
				oninput={onInput}
				onfocus={onFocus}
				onclick={beginSearch}
				onblur={onBlur}
				onkeydown={onKeyDown}
			/>
			<wa-icon class="chevron" name={open ? 'chevron-up' : 'chevron-down'} variant="solid"
			></wa-icon>
			<input type="hidden" name={field} value={committedValue} />

			{#if open}
				<div class="menu">
					<ul id={listId} role="listbox">
						{#if visibleOptions.length > 0}
							{#each visibleOptions as timezone, index (timezone)}
								<li>
									<button
										type="button"
										role="option"
										class:selected={index === highlightedIndex}
										aria-selected={index === highlightedIndex ? 'true' : 'false'}
										onmousedown={(event) => event.preventDefault()}
										onclick={() => select(timezone)}
									>
										{timezone}
									</button>
								</li>
							{/each}
						{:else}
							<li class="empty">No matching timezones</li>
						{/if}
					</ul>
				</div>
			{/if}
		</div>
		{#if showDeviceTimezoneAction && deviceTimezone}
			<!-- svelte-ignore a11y_click_events_have_key_events,a11y_no_static_element_interactions -->
			<wa-button
				type="button"
				appearance="outlined"
				class="set-device-timezone"
				onclick={useDeviceTimezone}
			>
				<wa-icon slot="start" name="location-dot" variant="solid"></wa-icon>
				Set to {deviceTimezone}
			</wa-button>
		{/if}
	</div>
	<p class="hint">Search for a city or region, like Europe/London.</p>
	{#if $errors}<span class="invalid">{$errors}</span>{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;

		label {
			font: inherit;
			font-size: var(--wa-form-control-label-font-size, var(--wa-font-size-s));
			font-weight: var(--wa-form-control-label-font-weight, var(--wa-font-weight-semibold, 600));
			color: var(--wa-form-control-label-color, var(--wa-color-text-normal));
		}

		.picker {
			position: relative;
			flex: 1 1 18rem;
			min-width: min(100%, 18rem);
		}

		.row {
			display: flex;
			align-items: flex-end;
			gap: 0.75rem;
			flex-wrap: wrap;
		}

		input[role='combobox'] {
			width: 100%;
			box-sizing: border-box;
			border: 1px solid var(--wa-color-surface-border);
			border-radius: var(--wa-border-radius-m);
			background: var(--wa-color-surface-default);
			color: var(--wa-color-text-normal);
			padding: 0.75rem 2.5rem 0.75rem 0.875rem;
			font: inherit;
			line-height: 1.4;
		}

		input[role='combobox']:focus {
			outline: 2px solid var(--wa-color-brand-fill-loud);
			outline-offset: 2px;
		}

		.chevron {
			position: absolute;
			right: 0.75rem;
			top: 50%;
			transform: translateY(-50%);
			pointer-events: none;
			color: var(--wa-color-text-quiet);
		}

		.menu {
			position: absolute;
			top: calc(100% + 0.375rem);
			left: 0;
			right: 0;
			z-index: 10;
			background: var(--wa-color-surface-raised);
			border: 1px solid var(--wa-color-surface-border);
			border-radius: var(--wa-border-radius-m);
			box-shadow: var(--wa-shadow-l);
			max-height: 16rem;
			overflow: auto;

			ul {
				list-style: none;
				padding: 0.25rem;
				margin: 0;
			}

			button {
				width: 100%;
				border: 0;
				background: transparent;
				text-align: left;
				font: inherit;
				color: inherit;
				padding: 0.625rem 0.75rem;
				border-radius: var(--wa-border-radius-s);
				cursor: pointer;
			}

			button:hover,
			button.selected {
				background: var(--wa-color-brand-fill-subtle);
			}

			.empty {
				padding: 0.625rem 0.75rem;
				color: var(--wa-color-text-quiet);
			}
		}

		.hint {
			margin: 0;
			font-size: 0.875rem;
			color: var(--wa-color-text-quiet);
		}

		.set-device-timezone {
			flex: 0 0 auto;
		}

		.invalid {
			color: var(--wa-color-text-danger);
		}
	}
</style>
