/**
 * TEMPORARY stand-in for the partners feature.
 *
 * The bottom nav shows one avatar per partner, so it needs *something* to
 * render before there is a `partners` table. These rows are hard-coded and
 * identical for every user.
 *
 * To replace this: add the table in `src/lib/server/db/schema/app.ts`, swap the
 * two calls below for queries in
 * `src/routes/(auth-required)/(app)/+layout.server.ts` and
 * `src/routes/(auth-required)/(app)/partner/[id]/+page.server.ts`, and delete
 * this file. `PartnerView` in `$lib/types` is the shape components rely on and
 * should survive the swap unchanged.
 */
import type { PartnerView } from './types';

const placeholderPartners: PartnerView[] = [
	{ id: 'placeholder-ada', name: 'Ada', image: null },
	{ id: 'placeholder-jun', name: 'Jun', image: null }
];

export function listPlaceholderPartners(): PartnerView[] {
	return placeholderPartners;
}

export function findPlaceholderPartner(id: string): PartnerView | undefined {
	return placeholderPartners.find((partner) => partner.id === id);
}
