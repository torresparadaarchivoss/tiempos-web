import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { sb } from './supabase'

export type Pais = { id_pais: number; codigo: string; nombre: string }
export type Perfil = { user_id: string; nombre: string; es_admin: boolean; activo: boolean }

type Estado = {
  session: Session | null
  perfil: Perfil | null
  paises: Pais[]
  cargando: boolean
  salir: () => Promise<void>
}

const AuthCtx = createContext<Estado | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [paises, setPaises] = useState<Pais[]>([])
  const [cargando, setCargando] = useState(true)

  // Carga perfil y países permitidos. RLS ya filtra: solo llegan los países del usuario.
  async function cargarUsuario(s: Session | null) {
    if (!s) {
      setPerfil(null)
      setPaises([])
      setCargando(false)
      return
    }
    const [{ data: p }, { data: pa }] = await Promise.all([
      sb.from('perfil').select('user_id, nombre, es_admin, activo').eq('user_id', s.user.id).maybeSingle(),
      sb.from('pais').select('id_pais, codigo, nombre').order('id_pais'),
    ])
    setPerfil((p as Perfil) ?? null)
    setPaises((pa as Pais[]) ?? [])
    setCargando(false)
  }

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session)
      cargarUsuario(data.session)
    })
    const { data: sub } = sb.auth.onAuthStateChange((_evento, s) => {
      setSession(s)
      cargarUsuario(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const salir = async () => {
    await sb.auth.signOut()
  }

  return (
    <AuthCtx.Provider value={{ session, perfil, paises, cargando, salir }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
