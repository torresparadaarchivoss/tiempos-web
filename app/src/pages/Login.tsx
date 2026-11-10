import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const logo = `${import.meta.env.BASE_URL}brand/logo_oscuro.png`

function IconoOjo({ abierto }: { abierto: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
      {!abierto && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  )
}

export default function Login() {
  const { session, cargando } = useAuth()
  const [correo, setCorreo] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (!cargando && session) return <Navigate to="/" replace />

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    const { error: err } = await sb.auth.signInWithPassword({ email: correo, password: clave })
    setEnviando(false)
    if (err) setError('Correo o contraseña incorrectos.')
  }

  return (
    <div className="login">
      <form className="tarjeta" onSubmit={entrar}>
        <img className="logo" src={logo} alt="Instacredit" />
        <h1>Tiempos de formalización</h1>
        <p className="sub">Ingresá con tu cuenta corporativa.</p>
        <label>
          Correo
          <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          Contraseña
          <span className="campo-clave">
            <input
              type={verClave ? 'text' : 'password'}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              className="ver-clave"
              onClick={() => setVerClave((v) => !v)}
              aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              title={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              <IconoOjo abierto={verClave} />
            </button>
          </span>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="boton-ingresar" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
        <p className="slogan">¡Apoyándote siempre!</p>
      </form>
    </div>
  )
}
