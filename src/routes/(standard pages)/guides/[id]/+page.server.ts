import { db } from '$lib/server/db'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ depends, params }) => {
    depends('supabase:db:guides')
    if (!params.id.match(/^\d+$/)) {
        return { status: 404 }
    }
    const guideId = parseInt(params.id)
    const guide = await db.query.guides.findFirst({
        where: (guides, { eq }) => eq(guides.id, guideId)
    })
    const tasks = await db.query.tasks.findMany({
        where: (tasks, { eq }) => eq(tasks.guideId, guideId),
        orderBy: (tasks, { asc }) => [asc(tasks.id)],
    })
    return {
        guide,
        tasks
    }
}