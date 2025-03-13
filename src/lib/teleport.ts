// Svelte action
// https://svelte.dev/tutorial/actions

export function teleport(node: HTMLElement, name: string) {
	const target = document.querySelector(name)
    if (!target) {
        throw new Error(`Element "${name}" not found`)
    }
    target.appendChild(node);

	return {
		destroy() {
			node.remove();
		}
	}
}