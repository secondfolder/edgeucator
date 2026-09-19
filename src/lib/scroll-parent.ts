/**
 * Finds the ancestor that actually scrolls.
 *
 * Extracted from `EdgeTask.svelte`, which needed it first and explains why: the app
 * shell gives `<main>` `overflow-y: auto` and takes the scroll off `<body>`, so
 * `window.scrollY` and `window.scrollTo` move nothing at all. Anything that
 * wants to keep something in view has to find the real scrollport.
 *
 * `ThreadView.svelte` needs the identical thing to keep the newest message
 * visible, and two copies of this would drift — one of them would get the
 * `document.scrollingElement` fallback wrong, or the offset arithmetic, and it
 * would only show up as a page that scrolls slightly to the wrong place.
 */
export function scrollParentOf(node: HTMLElement): HTMLElement {
	let candidate = node.parentElement;
	while (candidate) {
		const { overflowY } = getComputedStyle(candidate);
		if (overflowY === 'auto' || overflowY === 'scroll') return candidate;
		candidate = candidate.parentElement;
	}
	return (document.scrollingElement ?? document.documentElement ?? document.body) as HTMLElement;
}

/**
 * Scrolls `target` into view inside whichever ancestor really scrolls.
 *
 * The offset arithmetic is the fiddly half: the document's own rect already
 * carries the scroll offset, so only a genuine scrolling element needs its top
 * subtracted. Getting that wrong sends the page to almost the right place,
 * which is harder to notice than sending it nowhere.
 */
export function scrollIntoViewWithin(
	target: Element,
	from: HTMLElement,
	options: { gap?: number; behavior?: ScrollBehavior } = {}
): void {
	const scroller = scrollParentOf(from);
	const scrollerTop =
		scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
	const top =
		target.getBoundingClientRect().top - scrollerTop + scroller.scrollTop - (options.gap ?? 20);
	scroller.scrollTo({ top, behavior: options.behavior ?? 'smooth' });
}
