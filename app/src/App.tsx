import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { configuracionLista } from './lib/supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import Tablero from './pages/Tablero'

function Protegido({ children }: { children: ReactNode }) {
  const { session, cargando } = useAuth()
  if (cargando) return <p className="cargando">Cargando…</p>
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  if (!configuracionLista) {
    return (
      <div className="aviso">
        <h1>Falta configurar Supabase</h1>
        <p>
          Pegá la <strong>anon key</strong> en <code>app/.env.production</code> (VITE_SUPABASE_ANON_KEY) y vuelve a construir.
        </p>
      </div>
    )
  }
  return (
    <AuthProvider>
      <BrowserRouter basename="/tiempos-web">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Protegido>
                <Layout />
              </Protegido>
            }
          >
            <Route path="/" element={<Tablero />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
