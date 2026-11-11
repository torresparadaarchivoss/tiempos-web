import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { periodoPorDefecto } from '../lib/fechas'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'
import LeadTimeMes from '../components/LeadTimeMes'

// Insights: qué explica el tiempo a formalizar. Cálculos en la base (funciones insights e insights_cuartiles).
type Grupo = { grupo: string; formalizadas: number; mediana: number; p90: number; sla: number }
type Ranking = { grupo: string; creadas: number; formalizadas: number; conversion: number; mediana: number; sla: number }
type Cuart = { n: number; min: number; p25: number; mediana: number; p75: number; max: number }
type Dato = {
  n_formalizadas: number; pct_sin_retrocesos: number | null; costo_retroceso: number | null
  tipo: Grupo[] | null; canal: Grupo[] | null; dia: (Grupo & { orden: number })[] | null
  heat: { dia: number; hora: number; mediana: number }[] | null; ranking: Ranking[] | null
  tendencia: { mes: string; resultado: string; n: number }[] | null
  conversion_mes: { mes: string; conv: number }[] | null
  retrocesos: { desde: string; hacia: string; veces: number; solicitudes: number }[] | null
  creadas: number
}

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const RES_COLOR: Record<string, string> = {
  EXITOSA: PALETA.verde, RECHAZADA: PALETA.rojo, DESERCION: PALETA.naranja, EN_PROCESO: PALETA.cielo,
  ESTANCADA: PALETA.amarillo, SOLO_UN_ESTADO: '#9AA6C4',
}
const MIN_N = 5
const fmtH = (h: number | null | undefined) => (h == null ? '—' : `${h.toFixed(1)} HH`)
const fmtPct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`)
const colorSla = (s: number) => (s >= 0.8 ? PALETA.verde : s >= 0.5 ? PALETA.amarillo : PALETA.rojo)

function Barras({ items, titulo }: { items: Grupo[]; titulo: string }) {
  const orden = [...items].sort((a, b) => a.mediana - b.mediana)
  return (
    <Grafico
      height={Math.max(260, 36 * items.length + 80)}
      data={[{
        type: 'bar', orientation: 'h', x: orden.map((g) => g.mediana), y: orden.map((g) => g.grupo),
        text: orden.map((g) => `SLA ${fmtPct(g.sla)}`), textposition: 'outside',
        marker: { color: orden.map((g) => colorSla(g.sla)) },
        hovertemplate: '<b>%{y}</b><br>Mediana %{x:.1f} HH<extra></extra>',
      }]}
      layout={{
        title: { text: titulo, font: { size: 13 } }, showlegend: false, xaxis: { title: { text: 'Mediana HH' } },
        shapes: [{ type: 'line', x0: 24, x1: 24, yref: 'paper', y0: 0, y1: 1, line: { color: PALETA.gris, dash: 'dash' } }],
      }}
    />
  )
}

export default function Insights() {
  const { pais, sla } = useOutletContext<{ pais: { id_pais: number; nombre: string }; sla: number }>()
  const [desde, setDesde] = useState(periodoPorDefecto().desde)
  const [hasta, setHasta] = useState(periodoPorDefecto().hasta)
  const [tipo, setTipo] = useState('')
  const [canal, setCanal] = useState('')
  const [resultado, setResultado] = useState('EXITOSA')
  const [dimension, setDimension] = useState<'promotor' | 'sucursal' | 'usuario'>('promotor')
  const [dato, setDato] = useState<Dato | null>(null)
  const [cuart, setCuart] = useState<{ sin: Cuart | null; con: Cuart | null } | null>(null)
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
    const args = {
      p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta,
      p_tipos: tipo ? [tipo] : null, p_canales: canal ? [canal] : null,
      p_resultados: resultado === 'TODOS' ? null : [resultado],
    }
    Promise.all([
      sb.rpc('insights', { ...args, p_dimension: dimension, p_sla: sla }),
      sb.rpc('insights_cuartiles', args),
    ]).then(([r1, r2]) => {
      if (!vivo) return
      if (r1.error) setError('No se pudo calcular: ' + r1.error.message)
      else setDato(r1.data as Dato)
      if (!r2.error) setCuart(r2.data as { sin: Cuart | null; con: Cuart | null })
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, desde, hasta, tipo, canal, resultado, dimension, sla])

  if (error) return <p className="error">{error}</p>

  const tipoMasLento = dato?.tipo?.[0]
  const diaMasLento = dato?.dia?.reduce<(Grupo & { orden: number }) | undefined>((acc, d) => (!acc || d.mediana > acc.mediana ? d : acc), undefined)
  const tendMeses = [...new Set(dato?.tendencia?.map((t) => t.mes) ?? [])].sort()
  const tendRes = [...new Set(dato?.tendencia?.map((t) => t.resultado) ?? [])]
  const costo = dato?.costo_retroceso
  const cuartBox = cuart && cuart.sin && cuart.con

  return (
    <div className="resumen">
      <Cabecera kicker="Insights" titulo="¿Qué acelera y qué frena una formalización?" sub="Qué explica el tiempo a formalizar, por tipo, canal, día y retrocesos." pose="prestamito_pensando" />

      <div className="filtros-resumen">
        <label>Desde<input type="date" lang="es-CR" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" lang="es-CR" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label>Tipo de solicitud<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Canal<select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="">Todos</option>{canales.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label>Resultado<select value={resultado} onChange={(e) => setResultado(e.target.value)}><option value="EXITOSA">Formalizadas</option><option value="TODOS">Todos</option><option value="RECHAZADA">Rechazadas</option><option value="DESERCION">Desistidas</option></select></label>
      </div>

      {cargando && <p className="cargando">Calculando Insights de {pais.nombre}…</p>}

      {!cargando && dato && (
        <>
          <div className="kpis">
            <Kpi label="Formalizadas sin retrocesos" value={fmtPct(dato.pct_sin_retrocesos)} foot="pasaron por el flujo sin volver atrás" tono="verde" />
            <Kpi label="Costo de un retroceso" value={costo == null ? '—' : `${costo > 0 ? '+' : ''}${costo.toFixed(1)} HH`} foot="mediana con retrocesos menos sin retrocesos" tono="rojo" />
            <Kpi label="Tipo más lento" value={tipoMasLento?.grupo ?? '—'} foot={tipoMasLento ? `mediana ${fmtH(tipoMasLento.mediana)}` : ''} tono="naranja" />
            <Kpi label="Día de creación más lento" value={diaMasLento?.grupo ?? '—'} foot={diaMasLento ? `mediana ${fmtH(diaMasLento.mediana)}` : ''} tono="navy" />
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Por tipo de solicitud</h2>
              <p className="sub">Mediana HH a formalización y % dentro del SLA (grupos con {MIN_N}+ formalizadas)</p>
              {dato.tipo?.length ? <Barras items={dato.tipo} titulo="" /> : <p className="sub">Faltan datos para comparar.</p>}
            </div>
            <div className="tarjeta-seccion">
              <h2>Por canal</h2>
              <p className="sub">Mediana HH a formalización y % dentro del SLA (grupos con {MIN_N}+ formalizadas)</p>
              {dato.canal?.length ? <Barras items={dato.canal} titulo="" /> : <p className="sub">Faltan datos para comparar.</p>}
            </div>
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Mediana HH según día y hora de creación</h2>
              <p className="sub">Las celdas más oscuras son las franjas en que crear una solicitud sale más caro</p>
              <Grafico
                height={300}
                data={[{
                  type: 'heatmap', x: Array.from({ length: 12 }, (_, i) => `${i + 7}h`), y: DIAS,
                  z: DIAS.map((_, di) => Array.from({ length: 12 }, (_, i) => dato.heat?.find((h) => h.dia === di + 1 && h.hora === i + 7)?.mediana ?? null)),
                  colorscale: [[0, '#EDF5EC'], [0.5, PALETA.verde], [1, PALETA.navy]], colorbar: { title: { text: 'HH' } },
                  hovertemplate: '%{y} %{x}: %{z:.1f} HH<extra></extra>',
                }]}
                layout={{ yaxis: { autorange: 'reversed' } }}
              />
            </div>
            <div className="tarjeta-seccion">
              <h2>Impacto de los retrocesos</h2>
              <p className="sub">Distribución de HH a formalización</p>
              {cuartBox ? (
                <Grafico
                  height={300}
                  data={[
                    { type: 'box', name: 'Sin retrocesos', x: ['Sin retrocesos'], q1: [cuart!.sin!.p25], median: [cuart!.sin!.mediana], q3: [cuart!.sin!.p75], lowerfence: [cuart!.sin!.min], upperfence: [cuart!.sin!.max], marker: { color: PALETA.verde } },
                    { type: 'box', name: 'Con retrocesos', x: ['Con retrocesos'], q1: [cuart!.con!.p25], median: [cuart!.con!.mediana], q3: [cuart!.con!.p75], lowerfence: [cuart!.con!.min], upperfence: [cuart!.con!.max], marker: { color: PALETA.rojo } },
                  ]}
                  layout={{ yaxis: { title: { text: 'HH' } }, showlegend: false, shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: sla, y1: sla, line: { color: PALETA.gris, dash: 'dash' } }] }}
                />
              ) : <p className="sub">Sin datos suficientes para el diagrama.</p>}
            </div>
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Tendencia mensual</h2>
              <p className="sub">Solicitudes creadas por resultado (barras) y conversión a formalizada (línea)</p>
              <Grafico
                height={340}
                data={[
                  ...tendRes.map((r) => ({ type: 'bar', name: r.replace('_', ' '), x: tendMeses, y: tendMeses.map((m) => dato.tendencia?.find((t) => t.mes === m && t.resultado === r)?.n ?? 0), marker: { color: RES_COLOR[r] } })),
                  { type: 'scatter', mode: 'lines+markers+text', name: 'Conversión', x: tendMeses, y: tendMeses.map((m) => dato.conversion_mes?.find((c) => c.mes === m)?.conv ?? null), yaxis: 'y2', text: tendMeses.map((m) => fmtPct(dato.conversion_mes?.find((c) => c.mes === m)?.conv)), textposition: 'top center', line: { color: PALETA.navy, width: 2 } },
                ]}
                layout={{ barmode: 'stack', yaxis2: { overlaying: 'y', side: 'right', tickformat: '.0%', range: [0, 1.05], showgrid: false }, xaxis: { dtick: 'M1', tickformat: '%b %Y' } }}
              />
            </div>
            <div className="tarjeta-seccion">
              <h2>Retrocesos más frecuentes</h2>
              <p className="sub">Pasos que devuelven la solicitud a un estado ya visitado</p>
              {dato.retrocesos?.length ? (
                <table>
                  <thead><tr><th>Desde</th><th>Vuelve a</th><th>Veces</th><th>Solicitudes</th></tr></thead>
                  <tbody>{dato.retrocesos.map((r) => {
                    const max = Math.max(...dato.retrocesos!.map((x) => x.veces), 1)
                    return (
                      <tr key={r.desde + r.hacia}>
                        <td>{r.desde}</td><td>{r.hacia}</td>
                        <td><span className="barra-mini" style={{ width: `${(r.veces / max) * 100}%` }} /> {r.veces.toLocaleString('es-CR')}</td>
                        <td>{r.solicitudes.toLocaleString('es-CR')}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              ) : <p className="sub">¡Cero retrocesos en el periodo!</p>}
            </div>
          </div>

          <div className="tarjeta-seccion">
            <h2>Ranking</h2>
            <p className="sub">Grupos con {MIN_N}+ formalizadas, del más lento al más rápido</p>
            <div className="pestanas">
              {(['promotor', 'sucursal', 'usuario'] as const).map((d) => (
                <button key={d} type="button" className={dimension === d ? 'pestana activa' : 'pestana'} onClick={() => setDimension(d)}>
                  {d === 'usuario' ? 'Usuario que crea' : d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            {dato.ranking?.length ? (
              <table>
                <thead><tr><th>Grupo</th><th>Creadas</th><th>Formalizadas</th><th>Conversión</th><th>Mediana HH</th><th>% SLA</th></tr></thead>
                <tbody>{dato.ranking.map((r) => (
                  <tr key={r.grupo}><td>{r.grupo}</td><td>{r.creadas}</td><td>{r.formalizadas}</td><td>{fmtPct(r.conversion)}</td><td>{r.mediana.toFixed(1)}</td><td>{fmtPct(r.sla)}</td></tr>
                ))}</tbody>
              </table>
            ) : <p className="sub">Sin grupos con suficientes formalizadas.</p>}
          </div>

          <LeadTimeMes idPais={pais.id_pais} sla={sla} />

          <div className="preguntas">
            <h2>Preguntas y respuestas</h2>
            <div className="preguntas-grid">
              {costo != null && (
                <div className="qa"><b>¿Cuánto cuesta un retroceso?</b>{`Las formalizadas con retrocesos tardan ${Math.abs(costo).toFixed(1)} HH hábiles ${costo > 0 ? 'más' : 'menos'} en mediana; ${fmtPct(dato.pct_sin_retrocesos == null ? null : 1 - dato.pct_sin_retrocesos)} de las formalizadas tuvo al menos uno.`}</div>
              )}
              {tipoMasLento && (
                <div className="qa"><b>¿Qué tipo de solicitud tarda más?</b>{`«${tipoMasLento.grupo}» (${fmtH(tipoMasLento.mediana)}, SLA ${fmtPct(tipoMasLento.sla)}) es el más lento.`}</div>
              )}
              {dato.retrocesos?.[0] && (
                <div className="qa"><b>¿Cuál es el retroceso más común?</b>{`De «${dato.retrocesos[0].desde}» a «${dato.retrocesos[0].hacia}»: ${dato.retrocesos[0].veces.toLocaleString('es-CR')} veces en ${dato.retrocesos[0].solicitudes.toLocaleString('es-CR')} solicitudes.`}</div>
              )}
              {diaMasLento && (
                <div className="qa"><b>¿Influye el día de creación?</b>{`Las creadas el ${diaMasLento.grupo} tienen la mediana más alta (${fmtH(diaMasLento.mediana)}).`}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
