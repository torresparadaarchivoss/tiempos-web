import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configuracionLista = Boolean(url && anonKey)

// Si falta la anon key, la app muestra un aviso en lugar de fallar en silencio.
export const sb = createClient(url ?? 'https://invalid.supabase.co', anonKey ?? 'invalid', {
  auth: { persistSession: true, autoRefreshToken: true },
})
