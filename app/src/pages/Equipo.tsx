import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'

// Equipo y DAC. Cálculos en la base (función equipo).
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

export default function Equipo() {
  const { pais, rolesDac } = useOutletContext<{ pais: { id_pais: number; nombre: string }; rolesDac: string[] }>()
  const hoy = new Date()
  const hace3 = new Date(hoy)
  hace3.setMonth(hoy.getMonth() - 3)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [desde, setDesde] = useState(iso(hace3))
  const [hasta, setHasta] = useState(iso(hoy))
  const [tipo, setTipo] = useState('')
  const [canal, setCanal] = useState('')
  const [asig, setAsig] = useState<'atiende' | 'dejo'>('atiende')
  const [habil, setHabil] = useState(true)
  const [dim, setDim] = useState<'estado' | 'usuario' | 'rol'>('estado')
  const [rolesProd, setRolesProd] = useState<string[] | null>(null)
  const [rolesResp, setRolesResp] = useState<string[] | null>(null)
  const [dato, setDato] = useState<Dato | null>(null)
  const [tipos, setTipos] = useState<string[]>([])
  const [canales, setCanales] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    sb.from('resumen_mensual').select('tipo_solicitud').eq('id_pais', pais.id_pais).then(({ data }) => {
      if (vivo && data) setTipos([...new Set(data.map((r: { tipo_solicitud: string }) => r.tipo_solicitud))].sort())
    })
    sb.from('usuario_operativo').select('canal').eq('id_pais', pais.id_pais).then(({ data }) => {
      if (vivo && data) setCanales([...new Set(data.map((r: { canal: string | null }) => r.canal || 'SIN CANAL'))].sort())
    })
    return () => { vivo = false }
  }, [pais.id_pais])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.rpc('equipo', {
      p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta,
      p_tipos: tipo ? [tipo] : null, p_canales: canal ? [canal] : null, p_resultados: ['EXITOSA'],
      p_roles: rolesProd, p_roles_resp: rolesResp, p_asig: asig, p_habil: habil, p_dim: dim, p_roles_dac: rolesDac,
    }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo calcular: ' + err.message)
      else setDato(data as Dato)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, desde, hasta, tipo, canal, asig, habil, dim, rolesProd, rolesResp, rolesDac])

  if (error) return <p className="error">{error}</p>

  const alternar = (lista: string[], rol: string) => (lista.includes(rol) ? lista.filter((r) => r !== rol) : [...lista, rol])
  const promedio = dato?.prod_promedio_dia ?? 0

  return (
    <div className="resumen">
      <Cabecera kicker="Equipo y DAC" titulo="El equipo que hace posible cada formalización" sub="Productividad por persona y gestión DAC. Excluye usuarios inactivos y los estados posteriores a aprobado informa." pose="prestamito_equipo_celebrando" />

      <div className="filtros-resumen">
        <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label>Tipo de solicitud<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Canal<select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="">Todos</option>{canales.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>

      {cargando && <p className="cargando">Calculando Equipo y DAC de {pais.nombre}…</p>}

      {!cargando && dato && (
        <>
          <h2 className="seccion">Productividad del equipo</h2>
          <div className="filtros-resumen">
            <div className="grupo-roles">
              <span className="etiqueta-roles">Roles incluidos</span>
              {dato.prod_roles.map((r) => (
                <label key={r} className="casilla"><input type="checkbox" checked={dato.prod_roles_sel.includes(r)} onChange={() => setRolesProd(alternar(dato.prod_roles_sel, r))} /> {r}</label>
              ))}
            </div>
          </div>

          {dato.prod_personas === 0 ? (
            <div className="vacio"><h2>No hay movimientos para esos roles</h2><p>Asigná el rol ANALISTA a los usuarios en Parámetros.</p></div>
          ) : (
            <>
              <div className="kpis">
                <Kpi label="Personas con actividad" value={dato.prod_personas} tono="verde" />
                <Kpi label="Solicitudes por persona y día hábil" value={dato.prod_promedio_dia?.toFixed(1) ?? '—'} foot={`periodo de ${dato.dias_habiles} días hábiles`} tono="cielo" />
                <Kpi label="Mediana por persona (periodo)" value={dato.prod_mediana?.toFixed(0) ?? '—'} tono="navy" />
              </div>
              <div className="tarjeta-seccion">
                <h2>Solicitudes por día hábil, por persona</h2>
                <p className="sub">Solicitudes distintas que movió cada persona en el periodo</p>
                <Grafico
                  height={Math.max(300, 28 * dato.prod_usuarios.length + 90)}
                  data={[{
                    type: 'bar', orientation: 'h', x: [...dato.prod_usuarios].reverse().map((u) => u.por_dia), y: [...dato.prod_usuarios].reverse().map((u) => u.usuario),
                    marker: { color: PALETA.verde }, hovertemplate: '<b>%{y}</b><br>%{x:.2f} por día<extra></extra>',
                  }]}
                  layout={{ showlegend: false, shapes: [{ type: 'line', x0: promedio, x1: promedio, yref: 'paper', y0: 0, y1: 1, line: { color: PALETA.naranja, dash: 'dash' } }],
                    annotations: [{ x: promedio, y: 1, yref: 'paper', text: 'promedio', showarrow: false, yanchor: 'bottom' }], margin: { l: 8, r: 16, t: 30, b: 30 } }}
                />
              </div>
            </>
          )}

          <h2 className="seccion">Gestión DAC</h2>
          {dato.dac_solicitudes_con === 0 ? (
            <div className="vacio"><h2>Ninguna solicitud del periodo pasó por DAC</h2><p>Revisá los roles DAC en Parámetros o ampliá el periodo.</p></div>
          ) : (
            <>
              <div className="kpis">
                <Kpi label="Solicitudes con DAC" value={pct(dato.dac_solicitudes_con / dato.dac_solicitudes_total)} foot={`${nf(dato.dac_solicitudes_con)} de ${nf(dato.dac_solicitudes_total)}`} tono="verde" />
                <Kpi label="Diferencia de medianas" value={dato.dac_dif_medianas == null ? '—' : `${dato.dac_dif_medianas > 0 ? '+' : ''}${dato.dac_dif_medianas.toFixed(1)} HH`} foot="con DAC menos sin DAC. Referencia, no efecto causal" tono="naranja" />
                <Kpi label="Conversión con DAC" value={pct(dato.dac_conv_con)} foot={`vs solicitudes sin DAC (${pct(dato.dac_conv_sin)})`} tono="cielo" />
                <Kpi label="Horas hábiles en manos de DAC" value={pct(dato.dac_horas_pct)} foot="del tiempo hábil del proceso" tono="navy" />
              </div>
              <div className="tarjeta-seccion">
                <h2>Actividad por persona DAC</h2>
                <p className="sub">Movimientos y horas hábiles en manos de cada usuario DAC</p>
                <table>
                  <thead><tr><th>Usuario</th><th>Solicitudes</th><th>Movimientos</th><th>Horas hábiles</th></tr></thead>
                  <tbody>{dato.dac_usuarios.map((u) => (<tr key={u.usuario}><td>{u.usuario}</td><td>{u.solicitudes}</td><td>{u.movimientos}</td><td>{u.horas.toFixed(1)}</td></tr>))}</tbody>
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
                <button key={d} type="button" className={dim === d ? 'pestana activa' : 'pestana'} onClick={() => setDim(d)}>{d[0].toUpperCase() + d.slice(1)}</button>
              ))}
            </div>
          </div>
          <div className="filtros-resumen">
            <div className="grupo-roles">
              <span className="etiqueta-roles">Roles</span>
              {dato.resp_roles.map((r) => (
                <label key={r} className="casilla"><input type="checkbox" checked={dato.resp_roles_sel.includes(r)} onChange={() => setRolesResp(alternar(dato.resp_roles_sel, r))} /> {r}</label>
              ))}
            </div>
          </div>

          <div className="kpis">
            <Kpi label="Estadías gestionadas el mismo día" value={pct(dato.resp_mismo)} foot={`${nf(dato.resp_cerradas)} estadías cerradas`} tono="verde" />
            <Kpi label="Cambiaron de día" value={pct(dato.resp_cambio)} tono="naranja" />
            <Kpi label="Solicitudes con todo el mismo día" value={pct(dato.resp_solicitudes_mismo)} tono="cielo" />
            <Kpi label="Pendientes" value={nf(dato.resp_pendientes)} foot="estadías que todavía no salen del estado" tono="navy" />
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Mismo día vs cambio de día, por {dim}</h2>
              <p className="sub">Criterio {habil ? 'hábil' : 'calendario'} · estado asignado a {asig === 'atiende' ? 'quien lo atiende' : 'quien lo dejó ahí'}</p>
              <div className="tabla-scroll">
                <table>
                  <thead><tr><th>{dim}</th><th>Solicitudes</th><th>Estadías</th><th>Mismo día</th><th>% mismo día</th><th>Cambió día</th><th>% cambió día</th><th>Mediana días</th><th>Pendientes</th></tr></thead>
                  <tbody>{dato.resp_tabla.map((f) => (
                    <tr key={f.clave}><td>{f.clave}</td><td>{nf(f.solicitudes)}</td><td>{nf(f.estadias)}</td><td>{nf(f.mismo)}</td><td>{pct(f.pct_mismo)}</td><td>{nf(f.cambio)}</td><td>{pct(f.pct_cambio)}</td><td>{f.mediana_dias ?? '—'}</td><td>{nf(f.pendientes)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="tarjeta-seccion">
              <h2>Cuántos días tardó en salir</h2>
              <p className="sub">Distribución de las estadías cerradas</p>
              {dato.resp_distribucion.length > 0 && (
                <Grafico
                  height={300}
                  data={[{
                    type: 'bar', x: dato.resp_distribucion.map((d) => d.tramo), y: dato.resp_distribucion.map((d) => d.n),
                    text: dato.resp_distribucion.map((d) => pct(d.n / dato.resp_distribucion.reduce((a, x) => a + x.n, 0))), textposition: 'outside',
                    marker: { color: [PALETA.verde, PALETA.cielo, PALETA.amarillo, PALETA.rojo] },
                  }]}
                  layout={{ showlegend: false, yaxis: { title: { text: 'Estadías' } } }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
