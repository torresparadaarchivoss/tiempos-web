import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { fechaEs } from '../lib/fechas'
import { useContexto } from '../lib/contexto'
import { listaTipos, tiposConsulta } from '../lib/tipos'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'
import EquipoDac from '../components/EquipoDac'

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
  pend_comp?: { con: Comp | null; sin: Comp | null; estadias_pend: number; horas_pend: number }
}
type Comp = { estadias: number; pct_mismo: number | null; mediana_dias: number | null; horas_prom: number | null; horas: number | null }

const pct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(1)}%`)
const nf = (n: number) => n.toLocaleString('es-CR')
const COLOR_TRAMO: Record<string, string> = { 'Mismo día': PALETA.verde, '1 día': PALETA.cielo, '2 días': PALETA.amarillo }
// Filas de la comparación con/sin PENDIENTES: nombre, valor, formato y si es porcentaje
const FILAS_COMP: [string, (c: Comp) => number | null, (v: number) => string, boolean][] = [
  ['Estadías cerradas', (c) => c.estadias, (v) => nf(v), false],
  ['% gestionadas el mismo día', (c) => c.pct_mismo, (v) => pct(v), true],
  ['Mediana de días para salir', (c) => c.mediana_dias, (v) => v.toFixed(1), false],
  ['Horas hábiles promedio por estadía', (c) => c.horas_prom, (v) => `${v.toFixed(1)} HH`, false],
  ['Horas hábiles totales', (c) => c.horas, (v) => `${nf(Math.round(v))} HH`, false],
]

export default function Equipo() {
  const { pais, rolesDac, periodo, setPeriodo } = useContexto()
  const { desde, hasta } = periodo
  const [tipo, setTipo] = useState('')
  const [canal, setCanal] = useState('')
  const [asig, setAsig] = useState<'atiende' | 'dejo'>('atiende')
  const [habil, setHabil] = useState(true)
  const [dim, setDim] = useState<'estado' | 'usuario' | 'rol'>('estado')
  // Roles elegidos; null = los roles DAC de Parámetros (selección por defecto en las dos secciones)
  const [rolesProd, setRolesProd] = useState<string[] | null>(null)
  const [rolesResp, setRolesResp] = useState<string[] | null>(null)
  const [sinPend, setSinPend] = useState(false)
  const [dato, setDato] = useState<Dato | null>(null)
  const [tipos, setTipos] = useState<string[]>([])
  const [canales, setCanales] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Subpáginas de Equipo y DAC: cada una muestra solo su parte, para no bajar tanto en la página
  const [pestana, setPestana] = useState<'dac' | 'prod' | 'resp' | 'mes'>('dac')
  // Filtro: false = todo lo DAC antes de formalización; true = solo analistas
  const [soloAnalistas, setSoloAnalistas] = useState(false)
  // Filtro de PENDIENTES del equipo DAC (por defecto: todas)
  const [pend, setPend] = useState<'hasta_uno' | 'todas' | 'sin' | 'una' | 'dos_o_mas'>('todas')
  // VERIFICADOR MOTORIZADO: false = excluido del tiempo DAC (por defecto); en "Solo analistas" siempre se excluye
  const [verif, setVerif] = useState(false)

  useEffect(() => {
    let vivo = true
    sb.from('resumen_mensual').select('tipo_solicitud').eq('id_pais', pais.id_pais).then(({ data }) => {
      if (vivo && data) setTipos(listaTipos(data.map((r: { tipo_solicitud: string }) => r.tipo_solicitud)))
    })
    sb.from('usuario_operativo').select('canal').eq('id_pais', pais.id_pais).then(({ data }) => {
      if (vivo && data) setCanales([...new Set(data.map((r: { canal: string | null }) => r.canal || 'SIN CANAL'))].sort())
    })
    // Al cambiar de país se vuelve a la selección DAC
    setRolesProd(null)
    setRolesResp(null)
    return () => { vivo = false }
  }, [pais.id_pais])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.rpc('equipo', {
      p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta,
      p_tipos: tiposConsulta(tipo), p_canales: canal ? [canal] : null, p_resultados: null,
      p_roles: rolesProd ?? rolesDac, p_roles_resp: rolesResp ?? rolesDac, p_asig: asig, p_habil: habil, p_dim: dim, p_roles_dac: rolesDac,
      p_sin_pend: sinPend,
    }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo calcular: ' + err.message)
      else if (data) {
        // json_agg devuelve null cuando no hay filas: normalizamos a listas vacías
        const d = data as Dato
        setDato({
          ...d,
          prod_roles: d.prod_roles ?? [], prod_roles_sel: d.prod_roles_sel ?? [], prod_usuarios: d.prod_usuarios ?? [],
          dac_usuarios: d.dac_usuarios ?? [],
          resp_roles: d.resp_roles ?? [], resp_roles_sel: d.resp_roles_sel ?? [],
          resp_tabla: d.resp_tabla ?? [], resp_distribucion: d.resp_distribucion ?? [],
        })
      } else setDato(null)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, desde, hasta, tipo, canal, asig, habil, dim, rolesProd, rolesResp, rolesDac, sinPend])

  if (error) return <p className="error">{error}</p>

  const alternar = (lista: string[], rol: string) => (lista.includes(rol) ? lista.filter((r) => r !== rol) : [...lista, rol])
  const promedio = dato?.prod_promedio_dia ?? 0

  return (
    <div className={cargando && dato ? 'resumen recalculando' : 'resumen'}>
      {cargando && dato && <div className="actualizando" role="status">Actualizando…</div>}
      <Cabecera kicker="Equipo y DAC" titulo="El equipo que hace posible cada formalización" sub={`Periodo del ${fechaEs(desde)} al ${fechaEs(hasta)}. Productividad por persona y gestión DAC; excluye usuarios inactivos y los estados posteriores a aprobado informa.`} pose="prestamito_equipo_celebrando" />

      <div className="filtros-resumen">
        <label>Desde<input type="date" lang="es-CR" value={desde} onChange={(e) => e.target.value && setPeriodo({ desde: e.target.value, hasta })} /></label>
        <label>Hasta<input type="date" lang="es-CR" value={hasta} onChange={(e) => e.target.value && setPeriodo({ desde, hasta: e.target.value })} /></label>
        <label>Tipo de solicitud<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Canal<select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="">Todos</option>{canales.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>

      {cargando && !dato && <p className="cargando">Calculando Equipo y DAC de {pais.nombre}…</p>}

      <div className="grupo-roles" role="tablist" aria-label="Subpáginas de Equipo y DAC">
        <span className="etiqueta-roles">Ver</span>
        {([['dac', 'Gestión DAC'], ['prod', 'Productividad'], ['resp', 'Respuesta mismo día'], ['mes', 'Mensual']] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={pestana === k} className={pestana === k ? 'pestana activa' : 'pestana'} onClick={() => setPestana(k)}>{t}</button>
        ))}
      </div>

      <div className="filtros-resumen">
        <div className="grupo-roles">
          <span className="etiqueta-roles">¿Quiénes?</span>
          <button type="button" className={!soloAnalistas ? 'pestana activa' : 'pestana'} onClick={() => setSoloAnalistas(false)}>Todo el DAC</button>
          <button type="button" className={soloAnalistas ? 'pestana activa' : 'pestana'} onClick={() => setSoloAnalistas(true)}>Solo analistas</button>
        </div>
        <div className="grupo-roles">
          <span className="etiqueta-roles">¿Con cuántos PENDIENTES?</span>
          {([['hasta_uno', 'Hasta 1'], ['todas', 'Todas'], ['sin', 'Ninguno'], ['una', 'Exactamente 1'], ['dos_o_mas', '2 o más']] as const).map(([k, t]) => (
            <button key={k} type="button" className={pend === k ? 'pestana activa' : 'pestana'} onClick={() => setPend(k)}>{t}</button>
          ))}
        </div>
        <div className="grupo-roles">
          <span className="etiqueta-roles">¿Verificador motorizado?</span>
          <button type="button" className={!verif ? 'pestana activa' : 'pestana'} onClick={() => setVerif(false)}>Excluir</button>
          <button type="button" className={verif ? 'pestana activa' : 'pestana'} onClick={() => setVerif(true)}>Incluir</button>
        </div>
      </div>

      {(pestana === 'dac' || pestana === 'prod' || pestana === 'mes') && (
        <EquipoDac idPais={pais.id_pais} desde={desde} hasta={hasta} parte={pestana} soloAnalistas={soloAnalistas} pend={pend} verif={verif} tipo={tipo} canal={canal} />
      )}

      {dato && (
        <>
          {pestana === 'prod' && <>
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
            <div className="vacio"><h2>No hay movimientos para esos roles</h2><p>Marcá otros roles arriba o revisá los roles de los usuarios en Parámetros.</p></div>
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
                    annotations: [{ x: promedio, y: 1, yref: 'paper', text: 'promedio', showarrow: false, yanchor: 'bottom' }], margin: { t: 30 } }}
                />
              </div>
            </>
          )}

          </>}
          {pestana === 'dac' && <>
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

          </>}
          {pestana === 'resp' && <>
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
              <span className="etiqueta-roles">Estado PENDIENTES</span>
              <button type="button" className={!sinPend ? 'pestana activa' : 'pestana'} onClick={() => setSinPend(false)}>Con pendientes</button>
              <button type="button" className={sinPend ? 'pestana activa' : 'pestana'} onClick={() => setSinPend(true)}>Sin pendientes</button>
            </div>
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
            <Kpi label="Aún sin salir" value={nf(dato.resp_pendientes)} foot="estadías que todavía no salen del estado" tono="navy" />
          </div>

          {dato.pend_comp?.con && (
            <div className="tarjeta-seccion">
              <h2>Con y sin PENDIENTES</h2>
              <p className="sub">El estado PENDIENTES espera al cliente y no es trabajo del equipo. Sin él se ve el tiempo de respuesta propio de los roles elegidos (estadías cerradas).</p>
              <div className="tabla-scroll">
                <table>
                  <thead><tr><th>Indicador</th><th>Con pendientes</th><th>Sin pendientes</th><th>Diferencia</th></tr></thead>
                  <tbody>
                    {FILAS_COMP.map(([nombre, val, fmt, esPct]) => {
                      const a = val(dato.pend_comp!.con!)
                      const b = dato.pend_comp!.sin ? val(dato.pend_comp!.sin) : null
                      const dif = a != null && b != null ? b - a : null
                      return (
                        <tr key={nombre}>
                          <td>{nombre}</td><td>{a == null ? '—' : fmt(a)}</td><td>{b == null ? '—' : fmt(b)}</td>
                          <td>{dif == null ? '—' : `${dif > 0 ? '+' : ''}${esPct ? `${(dif * 100).toFixed(1)} pts` : fmt(dif)}`}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="sub">{`PENDIENTES: ${nf(dato.pend_comp.estadias_pend)} estadías y ${nf(Math.round(dato.pend_comp.horas_pend))} HH hábiles${dato.pend_comp.con.horas ? ` (${pct(dato.pend_comp.horas_pend / dato.pend_comp.con.horas)} de las horas)` : ''}. Los indicadores, la tabla y el gráfico de esta sección usan la opción elegida arriba: ${sinPend ? 'sin' : 'con'} pendientes.`}</p>
            </div>
          )}

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Mismo día vs cambio de día, por {dim}</h2>
              <p className="sub">Criterio {habil ? 'hábil' : 'calendario'} · estado asignado a {asig === 'atiende' ? 'quien lo atiende' : 'quien lo dejó ahí'}</p>
              <div className="tabla-scroll">
                <table>
                  <thead><tr><th>{dim}</th><th>Solicitudes</th><th>Estadías</th><th>Mismo día</th><th>% mismo día</th><th>Cambió día</th><th>% cambió día</th><th>Mediana días</th><th>Sin salir</th></tr></thead>
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
                    marker: { color: dato.resp_distribucion.map((d) => COLOR_TRAMO[d.tramo] ?? PALETA.rojo) },
                  }]}
                  layout={{ showlegend: false, yaxis: { title: { text: 'Estadías' } } }}
                />
              )}
            </div>
          </div>
          </>}
        </>
      )}
    </div>
  )
}
