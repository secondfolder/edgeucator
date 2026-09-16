import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { fetchEmbedMetadata } from '$lib/server/embed-metadata';
import type { RequestHandler } from './$types';

const requestSchema = z.object({
	urls: z.array(z.string().max(2048, 'URL too long')).max(50, 'Too many URLs')
});

/**
 * Normalises embed metadata for explicit URLs the client already extracted.
 *
 * The server still stores only ciphertext for the message body; this endpoint
 * exists so the browser can ask one first-party service to resolve preview data
 * before it encrypts that metadata into the message sidecar.
 */
export const POST: RequestHandler = async ({ locals, request, fetch }) => {
	if (!locals.user) error(401, 'Not signed in');

	const parsed = requestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, parsed.error.issues[0]?.message ?? 'Malformed request');

	const urls = [...new Set(parsed.data.urls)];
	const embeds = (await Promise.all(urls.map((url) => fetchEmbedMetadata(url, fetch)))).filter(
		(embed): embed is NonNullable<typeof embed> => embed !== null
	);

	return json(
		{ embeds },
		{
			headers: {
				// Derived from decrypted message text. Keep it request-local.
				'cache-control': 'no-store'
			}
		}
	);
};
