import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { sb } from '../lib/supabase'

const logo = `${import.meta.env.BASE_URL}brand/logo_claro.png`

// Secciones del tablero original. Las marcadas "pronto" aún no están portadas.
const SECCIONES = [
  { to: '/comparativo', titulo: 'Comparativo regional', listo: true },
  { to: '/resumen', titulo: 'Resumen', listo: true },
  { to: '/insights', titulo: 'Insights', listo: true },
  { to: '/cuellos', titulo: 'Cuellos y reprocesos', listo: true },
  { to: '/abiertas', titulo: 'Abiertas y posibles errores', listo: true },
  { to: '/equipo', titulo: 'Equipo y DAC', listo: true },
  { to: '/consulta', titulo: 'Consulta por solicitud', listo: true },
  { to: '/parametros', titulo: 'Parámetros', listo: true },
]

export default function Layout() {
  const { perfil, paises, salir } = useAuth()
  const [elegido, setElegido] = useState<number | null>(null)
  const [resultado, setResultado] = useState<'EXITOSA' | 'TODOS'>('EXITOSA')
  const pais = paises.find((p) => p.id_pais === elegido) ?? paises[0]
  // SLA y roles DAC del país, tomados de Parámetros (valores por defecto mientras carga)
  const [params, setParams] = useState<{ sla: number; rolesDac: string[] }>({ sla: 24, rolesDac: ['DAC'] })
  const paisId = pais?.id_pais
  useEffect(() => {
    if (paisId == null) return
    let vivo = true
    sb.from('parametro_pais').select('clave, valor').eq('id_pais', paisId).then(({ data }) => {
      if (!vivo || !data) return
      const m = Object.fromEntries(data.map((x: { clave: string; valor: string }) => [x.clave, x.valor]))
      setParams({
        sla: Number(m.SLA_HH ?? 24),
        rolesDac: String(m.ROLES_DAC ?? 'DAC').split(',').map((r) => r.trim()).filter(Boolean),
      })
    })
    return () => { vivo = false }
  }, [paisId])

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

        <label className="menu-pais">
          Resultado
          <select value={resultado} onChange={(e) => setResultado(e.target.value as 'EXITOSA' | 'TODOS')}>
            <option value="EXITOSA">Formalizadas (exitosas)</option>
            <option value="TODOS">Todos los resultados</option>
          </select>
        </label>

        <nav className="menu-secciones">
          {SECCIONES.filter((s) => s.to !== '/parametros' || perfil?.es_admin).map((s) =>
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
          <Outlet context={{ pais, sla: params.sla, rolesDac: params.rolesDac, resultado }} />
        )}
      </main>
    </div>
  )
}
