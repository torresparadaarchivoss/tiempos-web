import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'

type Prod = { usuario: string; solicitudes: number; por_dia: number }
type Fila = {
  clave: string; solicitudes: number; estadias: number; mismo: number; pct_mismo: number | null; cambio: number
  pct_cambio: number | null; mediana_dias: number | null; pendientes: number
}
type Dato = {
  dias_habiles: number; prod_personas: number; prod_promedio_dia: number | null; prod_mediana: number | null
  prod_roles: string[]; prod_roles_sel: string[]; prod_usuarios: Prod[]
  dac_solicitudes_con: number; dac_solicitudes_total: number; dac_dif_medianas: number | null
  dac_conv_con: number | null; dac_conv_sin: number | null; dac_horas_pct: number | null
  dac_usuarios: { usuario: string; solicitudes: number; movimientos: number; horas: number }[]
  resp_roles: string[]; resp_roles_sel: string[]; resp_cerradas: number; resp_mismo: number | null
  resp_cambio: number | null; resp_pendientes: number; resp_solicitudes_mismo: number | null
  resp_tabla: Fila[]; resp_distribucion: { tramo: string; n: number }[]
}

const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
const nf = (n: number) => n.toLocaleString('es-CR')
const DIM_TITULO: Record<string, string> = { estado: 'estado', usuario: 'usuario', rol: 'rol' }

export default function Equipo() {
  const { pais } = useOutletContext<{ pais: { id_pais: number; nombre: string } }>()
  const hoy = new Date()
  const hace3 = new Date(hoy)
  hace3.setMonth(hoy.getMonth() - 3)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [desde, setDesde] = useState(iso(hace3))
  const [hasta, setHasta] = useState(iso(hoy))
  const [tipo, setTipo] = useState('')
  const [asig, setAsig] = useState<'atiende' | 'dejo'>('atiende')
  const [habil, setHabil] = useState(true)
  const [dim, setDim] = useState<'estado' | 'usuario' | 'rol'>('estado')
  const [rolesProd, setRolesProd] = useState<string[] | null>(null)
  const [rolesResp, setRolesResp] = useState<string[] | null>(null)
  const [dato, setDato] = useState<Dato | null>(null)
  const [tipos, setTipos] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    sb.from('resumen_mensual').select('tipo_solicitud').eq('id_pais', pais.id_pais).then(({ data }) => {
      if (!vivo || !data) return
      setTipos([...new Set(data.map((r: { tipo_solicitud: string }) => r.tipo_solicitud))].sort())
    })
    return () => { vivo = false }
  }, [pais.id_pais])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.rpc('equipo', {
      p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta,
      p_tipos: tipo ? [tipo] : null, p_canales: null, p_resultados: ['EXITOSA'],
      p_roles: rolesProd, p_roles_resp: rolesResp, p_asig: asig, p_habil: habil, p_dim: dim,
      p_roles_dac: ['DAC'],
    }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo calcular: ' + err.message)
      else setDato(data as Dato)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, desde, hasta, tipo, asig, habil, dim, rolesProd, rolesResp])

  if (error) return <p className="error">{error}</p>

  const alternar = (lista: string[], rol: string) =>
    lista.includes(rol) ? lista.filter((r) => r !== rol) : [...lista, rol]

  return (
    <div className="resumen">
      <div className="filtros-resumen">
        <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label>
          Tipo de solicitud
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      {cargando && <p className="cargando">Calculando Equipo y DAC de {pais.nombre}…</p>}

      {!cargando && dato && (
        <>
          <h2 className="seccion">Productividad del equipo</h2>
          <div className="filtros-resumen">
            <div className="grupo-roles">
              <span className="etiqueta-roles">Roles incluidos</span>
              {dato.prod_roles.map((r) => (
                <label key={r} className="casilla">
                  <input type="checkbox" checked={dato.prod_roles_sel.includes(r)}
                    onChange={() => setRolesProd(alternar(dato.prod_roles_sel, r))} /> {r}
                </label>
              ))}
            </div>
          </div>
          {dato.prod_personas === 0 ? (
            <div className="vacio"><h2>No hay movimientos para esos roles</h2><p>Asigná el rol ANALISTA a los usuarios en Parámetros.</p></div>
          ) : (
            <>
              <div className="kpis">
                <div className="kpi"><span>Personas con actividad</span><strong>{dato.prod_personas}</strong></div>
                <div className="kpi"><span>Solicitudes por persona y día hábil</span><strong>{dato.prod_promedio_dia?.toFixed(1) ?? '—'}</strong><small>periodo de {dato.dias_habiles} días hábiles</small></div>
                <div className="kpi"><span>Mediana por persona (periodo)</span><strong>{dato.prod_mediana?.toFixed(0) ?? '—'}</strong></div>
              </div>
              <div className="tarjeta-seccion">
                <h2>Solicitudes por día hábil, por persona</h2>
                <p className="sub">Solicitudes distintas que movió cada persona en el periodo</p>
                {dato.prod_usuarios.map((u) => {
                  const max = Math.max(...dato.prod_usuarios.map((x) => x.por_dia), 1)
                  return (
                    <div key={u.usuario} className="barra-fila">
                      <span className="barra-etiqueta">{u.usuario}</span>
                      <div className="barra-pista"><div className="barra-valor" style={{ width: `${(u.por_dia / max) * 100}%` }} /></div>
                      <span className="barra-numero">{u.por_dia.toFixed(1)}</span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <h2 className="seccion">Gestión DAC</h2>
          {dato.dac_solicitudes_con === 0 ? (
            <div className="vacio"><h2>Ninguna solicitud del periodo pasó por DAC</h2><p>Revisá los roles DAC en Parámetros o ampliá el periodo.</p></div>
          ) : (
            <>
              <div className="kpis">
                <div className="kpi"><span>Solicitudes con DAC</span><strong>{pct(dato.dac_solicitudes_con / dato.dac_solicitudes_total)}</strong><small>{nf(dato.dac_solicitudes_con)} de {nf(dato.dac_solicitudes_total)}</small></div>
                <div className="kpi"><span>Diferencia de medianas</span><strong>{dato.dac_dif_medianas == null ? '—' : `${dato.dac_dif_medianas > 0 ? '+' : ''}${dato.dac_dif_medianas.toFixed(1)} HH`}</strong><small>con DAC menos sin DAC. Referencia, no efecto causal</small></div>
                <div className="kpi"><span>Conversión con DAC</span><strong>{pct(dato.dac_conv_con)}</strong><small>vs solicitudes sin DAC ({pct(dato.dac_conv_sin)})</small></div>
                <div className="kpi"><span>Horas hábiles en manos de DAC</span><strong>{pct(dato.dac_horas_pct)}</strong><small>del tiempo hábil del proceso</small></div>
              </div>
              <div className="tarjeta-seccion">
                <h2>Actividad por persona DAC</h2>
                <p className="sub">Movimientos y horas hábiles en manos de cada usuario DAC</p>
                <table>
                  <thead><tr><th>Usuario</th><th>Solicitudes</th><th>Movimientos</th><th>Horas hábiles</th></tr></thead>
                  <tbody>{dato.dac_usuarios.map((u) => (
                    <tr key={u.usuario}><td>{u.usuario}</td><td>{u.solicitudes}</td><td>{u.movimientos}</td><td>{u.horas.toFixed(1)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}

          <h2 className="seccion">Respuesta en el mismo día</h2>
          <p className="sub">Cada fila es una estadía: una vez que la solicitud estuvo en un estado. Mismo día = salió del estado el mismo día en que llegó.</p>
          <div className="filtros-resumen">
            <div className="grupo-roles">
              <span className="etiqueta-roles">El estado se asigna al rol de</span>
              <button type="button" className={asig === 'atiende' ? 'pestana activa' : 'pestana'} onClick={() => setAsig('atiende')}>Quien lo atiende</button>
              <button type="button" className={asig === 'dejo' ? 'pestana activa' : 'pestana'} onClick={() => setAsig('dejo')}>Quien lo dejó ahí</button>
            </div>
            <div className="grupo-roles">
              <span className="etiqueta-roles">Criterio de día</span>
              <button type="button" className={habil ? 'pestana activa' : 'pestana'} onClick={() => setHabil(true)}>Hábil</button>
              <button type="button" className={!habil ? 'pestana activa' : 'pestana'} onClick={() => setHabil(false)}>Calendario</button>
            </div>
            <div className="grupo-roles">
              <span className="etiqueta-roles">Agrupar por</span>
              {(['estado', 'usuario', 'rol'] as const).map((d) => (
                <button key={d} type="button" className={dim === d ? 'pestana activa' : 'pestana'} onClick={() => setDim(d)}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="filtros-resumen">
            <div className="grupo-roles">
              <span className="etiqueta-roles">Roles</span>
              {dato.resp_roles.map((r) => (
                <label key={r} className="casilla">
                  <input type="checkbox" checked={dato.resp_roles_sel.includes(r)}
                    onChange={() => setRolesResp(alternar(dato.resp_roles_sel, r))} /> {r}
                </label>
              ))}
            </div>
          </div>

          <div className="kpis">
            <div className="kpi"><span>Estadías gestionadas el mismo día</span><strong>{pct(dato.resp_mismo)}</strong><small>{nf(dato.resp_cerradas)} estadías cerradas</small></div>
            <div className="kpi"><span>Cambiaron de día</span><strong>{pct(dato.resp_cambio)}</strong></div>
            <div className="kpi"><span>Solicitudes con todo el mismo día</span><strong>{pct(dato.resp_solicitudes_mismo)}</strong></div>
            <div className="kpi"><span>Pendientes</span><strong>{nf(dato.resp_pendientes)}</strong><small>estadías que todavía no salen del estado</small></div>
          </div>

          <div className="tarjeta-seccion">
            <h2>Mismo día vs cambio de día, por {DIM_TITULO[dim]}</h2>
            <p className="sub">Criterio {habil ? 'hábil' : 'calendario'} · estado asignado a {asig === 'atiende' ? 'quien lo atiende' : 'quien lo dejó ahí'}</p>
            <div className="tabla-scroll">
              <table>
                <thead><tr>
                  <th>{DIM_TITULO[dim][0].toUpperCase() + DIM_TITULO[dim].slice(1)}</th><th>Solicitudes</th><th>Estadías</th>
                  <th>Mismo día</th><th>% mismo día</th><th>Cambió día</th><th>% cambió día</th><th>Mediana de días</th><th>Pendientes</th>
                </tr></thead>
                <tbody>{dato.resp_tabla.map((f) => (
                  <tr key={f.clave}>
                    <td>{f.clave}</td><td>{nf(f.solicitudes)}</td><td>{nf(f.estadias)}</td><td>{nf(f.mismo)}</td>
                    <td>{pct(f.pct_mismo)}</td><td>{nf(f.cambio)}</td><td>{pct(f.pct_cambio)}</td>
                    <td>{f.mediana_dias ?? '—'}</td><td>{nf(f.pendientes)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className="tarjeta-seccion">
            <h2>Cuántos días tardó en salir</h2>
            <p className="sub">Distribución de las estadías cerradas</p>
            {dato.resp_distribucion.map((d) => {
              const total = dato.resp_distribucion.reduce((a, x) => a + x.n, 0) || 1
              return (
                <div key={d.tramo} className="barra-fila">
                  <span className="barra-etiqueta">{d.tramo}</span>
                  <div className="barra-pista"><div className="barra-valor" style={{ width: `${(d.n / total) * 100}%` }} /></div>
                  <span className="barra-numero">{pct(d.n / total)}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
