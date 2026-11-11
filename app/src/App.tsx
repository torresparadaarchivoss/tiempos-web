import type { ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { configuracionLista } from './lib/supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import Resumen from './pages/Resumen'
import Cuellos from './pages/Cuellos'
import Insights from './pages/Insights'
import Abiertas from './pages/Abiertas'
import Consulta from './pages/Consulta'
import Equipo from './pages/Equipo'
import Parametros from './pages/Parametros'
import ErrorBoundary from './components/ErrorBoundary'

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
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Protegido>
                <ErrorBoundary>
                  <Layout />
                </ErrorBoundary>
              </Protegido>
            }
          >
            <Route path="/" element={<Navigate to="/resumen" replace />} />
            <Route path="/resumen" element={<Resumen />} />
            <Route path="/cuellos" element={<Cuellos />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/abiertas" element={<Abiertas />} />
            <Route path="/consulta" element={<Consulta />} />
            <Route path="/equipo" element={<Equipo />} />
            <Route path="/parametros" element={<Parametros />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
