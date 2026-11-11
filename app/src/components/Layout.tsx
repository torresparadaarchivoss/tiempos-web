import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const logo = `${import.meta.env.BASE_URL}brand/logo_claro.png`

// Secciones del tablero original. Las marcadas "pronto" aún no están portadas.
const SECCIONES = [
  { to: '/resumen', titulo: 'Resumen', listo: true },
  { to: '/insights', titulo: 'Insights', listo: true },
  { to: '/cuellos', titulo: 'Cuellos y reprocesos', listo: true },
  { to: '/abiertas', titulo: 'Abiertas y posibles errores', listo: true },
  { to: '/equipo', titulo: 'Equipo y DAC', listo: false },
  { to: '/consulta', titulo: 'Consulta por solicitud', listo: true },
  { to: '/parametros', titulo: 'Parámetros', listo: false },
]

export default function Layout() {
  const { perfil, paises, salir } = useAuth()
  const [elegido, setElegido] = useState<number | null>(null)
  const pais = paises.find((p) => p.id_pais === elegido) ?? paises[0]

  return (
    <div className="app">
      <aside className="menu">
        <img className="logo" src={logo} alt="Instacredit" />

        {paises.length > 0 && (
          <label className="menu-pais">
            País
            <select value={pais.id_pais} onChange={(e) => setElegido(Number(e.target.value))}>
              {paises.map((p) => (
                <option key={p.id_pais} value={p.id_pais}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
        )}

        <nav className="menu-secciones">
          {SECCIONES.map((s) =>
            s.listo ? (
              <NavLink key={s.to} to={s.to}>{s.titulo}</NavLink>
            ) : (
              <span key={s.to} className="pendiente" title="Pendiente de portar">
                {s.titulo} <small>pronto</small>
              </span>
            ),
          )}
        </nav>

        <div className="usuario">
          <span>{perfil?.nombre ?? 'Usuario'}</span>
          <button type="button" onClick={salir}>Salir</button>
        </div>
        <p className="slogan">¡Apoyándote siempre!</p>
      </aside>
      <main className="contenido">
        {paises.length === 0 ? (
          <div className="vacio">
            <h1>Sin países asignados</h1>
            <p>Tu cuenta todavía no tiene acceso a ningún país. Pedí a un administrador que te lo asigne.</p>
          </div>
        ) : (
          <Outlet context={{ pais }} />
        )}
      </main>
    </div>
  )
}
