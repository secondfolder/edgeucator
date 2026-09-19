export const EMBED_AUTO_LOAD_PROMPT_THRESHOLD = 3;

const localEmbedAutoLoadOverrides = new Map<string, boolean | null>();

export function embedAutoLoadPromptCountStorageKey(userId: string): string {
	return `bound-up:embed-auto-load-show-count:${userId}`;
}

export function embedAutoLoadPreferenceStorageKey(userId: string): string {
	return `bound-up:embed-auto-load:${userId}`;
}

export function readLocalEmbedAutoLoadPreference(userId: string): boolean | null {
	if (localEmbedAutoLoadOverrides.has(userId)) {
		return localEmbedAutoLoadOverrides.get(userId) ?? null;
	}
	if (typeof window === 'undefined') return null;
	const value = window.localStorage.getItem(embedAutoLoadPreferenceStorageKey(userId));
	if (value === 'auto') return true;
	if (value === 'manual') return false;
	return null;
}

export function writeLocalEmbedAutoLoadPreference(userId: string, enabled: boolean): void {
	localEmbedAutoLoadOverrides.set(userId, enabled);
	if (typeof window === 'undefined') return;
	window.localStorage.setItem(
		embedAutoLoadPreferenceStorageKey(userId),
		enabled ? 'auto' : 'manual'
	);
}

export function clearLocalEmbedAutoLoadPreference(userId: string): void {
	localEmbedAutoLoadOverrides.delete(userId);
	if (typeof window === 'undefined') return;
	window.localStorage.removeItem(embedAutoLoadPreferenceStorageKey(userId));
}

export function embedAutoLoadActivationDelayMs(input: {
	intersectionRatio: number;
	distancePx: number;
	velocityPxPerMs: number;
}): number {
	const speed = Math.abs(input.velocityPxPerMs);
	if (input.intersectionRatio >= 0.6) return 0;
	if (input.distancePx <= 48 && speed < 1.4) return 0;
	if (speed < 0.2) return 0;
	if (speed < 0.7) return 120;
	if (input.distancePx < 120) return 120;
	if (speed < 1.4) return 220;
	return 360;
}
