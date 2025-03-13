import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ depends, locals: { supabase } }) => {
    depends('supabase:db:guides')
    const { data: guides } = await supabase.from('guides').select('id,title').order('id')
    return { guides: guides ?? [] }
}