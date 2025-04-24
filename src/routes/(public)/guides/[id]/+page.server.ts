import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ depends, params, locals: { pb } }) => {
    if (!params.id.match(/^[a-z0-9]+$/)) {
        return { status: 404 }
    }
    depends(`pb:guides:${params.id}`)

    const guide = await pb.collection('guides').getOne(params.id, {
        expand: 'tasks_via_guide_id',
    });

    return {
        guide,
    }
}