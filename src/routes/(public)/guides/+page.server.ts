import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ depends, locals: { pb } }) => {
	depends('pb:guides');
	const guides = await pb.collection('guides').getFullList();
	console.log(guides);
	return { guides };
};
