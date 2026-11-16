import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { useContexto } from '../lib/contexto'
import { listaTipos, tiposConsulta } from '../lib/tipos'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'
import LeadTimeMes from '../components/LeadTimeMes'

// Hallazgos: qué explica el Lead Time de formalización. Cálculos en la base
// (funciones insights, insights_distribucion y pendientes_generados).
type Grupo = { grupo: string; formalizadas: number; mediana: number; p90: number; sla: number }
type Ranking = { grupo: string; creadas: number; formalizadas: number; conversion: number; mediana: number; sla: number }
type Dato = {
  n_formalizadas: number; pct_sin_retrocesos: number | null; costo_retroceso: number | null
  tipo: Grupo[] | null; canal: Grupo[] | null
  heat: { dia: number; hora: number; mediana: number }[] | null; ranking: Ranking[] | null
  tendencia: { mes: string; resultado: string; n: number }[] | null
  conversion_mes: { mes: string; conv: number }[] | null
  retrocesos: { desde: string; hacia: string; veces: number; solicitudes: number }[] | null
  creadas: number
}
type Distribucion = {
  tramos: { grupo: 'sin' | 'con'; tramo: number; n: number }[]
  n_sin: number; n_con: number; med_sin: number | null; med_con: number | null
}
type Pendientes = { veces: number; solicitudes_con: number; solicitudes_total: number }

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const RES_COLOR: Record<string, string> = {
  EXITOSA: PALETA.verde, RECHAZADA: PALETA.rojo, DESERCION: PALETA.naranja, EN_PROCESO: PALETA.cielo,
  ESTANCADA: PALETA.amarillo, SOLO_UN_ESTADO: '#9AA6C4',
}
const MIN_N = 5
const ANCHO = 4   // HH por tramo del histograma (el último tramo agrupa 60 HH o más)
const TRAMOS = Array.from({ length: 16 }, (_, i) => (i < 15 ? `${i * ANCHO}–${(i + 1) * ANCHO}` : '60+'))
const fmtH = (h: number | null | undefined) => (h == null ? '—' : `${h.toFixed(1)} HH`)
const fmtPct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`)
const nf = (n: number) => n.toLocaleString('es-CR')
const colorSla = (s: number) => (s >= 0.8 ? PALETA.verde : s >= 0.5 ? PALETA.amarillo : PALETA.rojo)

function Barras({ items, sla }: { items: Grupo[]; sla: number }) {
  const orden = [...items].sort((a, b) => a.mediana - b.mediana)
  return (
    <Grafico
      height={Math.max(260, 40 * items.length + 100)}
      data={[{
        type: 'bar', orientation: 'h', x: orden.map((g) => g.mediana), y: orden.map((g) => g.grupo),
        text: orden.map((g) => `SLA ${fmtPct(g.sla)}`), textposition: 'outside',
        marker: { color: orden.map((g) => colorSla(g.sla)) },
        hovertemplate: '<b>%{y}</b><br>Lead Time mediano %{x:.1f} HH<extra></extra>',
      }]}
      layout={{
        showlegend: false, xaxis: { title: { text: 'Lead Time mediano (HH)' }, rangemode: 'tozero' },
        margin: { r: 80 },
        shapes: [{ type: 'line', x0: sla, x1: sla, yref: 'paper', y0: 0, y1: 1, line: { color: PALETA.gris, dash: 'dash' } }],
      }}
    />
  )
}

export default function Hallazgos() {
  const { pais, sla, resultado, periodo, setPeriodo } = useContexto()
  const { desde, hasta } = periodo
  const [tipo, setTipo] = useState('')
  const [canal, setCanal] = useState('')
  const [dimension, setDimension] = useState<'sucursal' | 'usuario'>('sucursal')
  const [dato, setDato] = useState<Dato | null>(null)
  const [dist, setDist] = useState<Distribucion | null>(null)
  const [pend, setPend] = useState<Pendientes | null>(null)
  const [tipos, setTipos] = useState<string[]>([])
  const [canales, setCanales] = useState<string[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    sb.from('resumen_mensual').select('tipo_solicitud').eq('id_pais', pais.id_pais).then(({ data }) => {
      if (vivo && data) setTipos(listaTipos(data.map((r: { tipo_solicitud: string }) => r.tipo_solicitud)))
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
    const base = {
      p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta,
      p_tipos: tiposConsulta(tipo), p_canales: canal ? [canal] : null,
    }
    const args = { ...base, p_resultados: resultado === 'TODOS' ? null : ['EXITOSA'] }
    Promise.all([
      sb.rpc('insights', { ...args, p_dimension: dimension, p_sla: sla }),
      sb.rpc('insights_distribucion', args),
      sb.rpc('pendientes_generados', { ...base, p_resultados: null }),   // todas las solicitudes del periodo
    ]).then(([r1, r2, r3]) => {
      if (!vivo) return
      if (r1.error) setError('No se pudo calcular: ' + r1.error.message)
      else setDato(r1.data as Dato)
      setDist(r2.error ? null : (r2.data as Distribucion))
      setPend(r3.error ? null : (r3.data as Pendientes))
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, desde, hasta, tipo, canal, resultado, dimension, sla])

  if (error) return <p className="error">{error}</p>

  const tipoMasLento = dato?.tipo?.[0]
  const tendMeses = [...new Set(dato?.tendencia?.map((t) => t.mes) ?? [])].sort()
  const tendRes = [...new Set(dato?.tendencia?.map((t) => t.resultado) ?? [])]
  const costo = dato?.costo_retroceso

  // Histograma: % de cada grupo por tramo de Lead Time (los dos grupos quedan en la misma escala)
  const serieDist = (g: 'sin' | 'con') => {
    const total = g === 'sin' ? dist?.n_sin ?? 0 : dist?.n_con ?? 0
    return TRAMOS.map((_, i) => {
      const n = dist?.tramos.find((t) => t.grupo === g && t.tramo === i)?.n ?? 0
      return total ? n / total : 0
    })
  }
  const hayDist = !!dist && dist.n_sin > 0 && dist.n_con > 0
  // Posición de un valor en HH sobre el eje de tramos (categorías): índice fraccional
  const posTramo = (h: number | null) => (h == null ? null : Math.min(h / ANCHO, 15.5) - 0.5)
  const posSla = Math.min(sla / ANCHO, 15.5) - 0.5

  return (
    <div className="resumen">
      <Cabecera kicker="Hallazgos" titulo="¿Qué acelera y qué frena una formalización?" sub="Qué explica el Lead Time de formalización, por tipo, canal, franja horaria y retrocesos." pose="prestamito_pensando" />

      <div className="filtros-resumen">
        <label>Desde<input type="date" lang="es-CR" value={desde} onChange={(e) => e.target.value && setPeriodo({ desde: e.target.value, hasta })} /></label>
        <label>Hasta<input type="date" lang="es-CR" value={hasta} onChange={(e) => e.target.value && setPeriodo({ desde, hasta: e.target.value })} /></label>
        <label>Tipo de solicitud<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Canal<select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="">Todos</option>{canales.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>

      {cargando && <p className="cargando">Calculando hallazgos de {pais.nombre}…</p>}

      {!cargando && dato && (
        <>
          <div className="kpis">
            <Kpi label="Formalizadas sin retrocesos" value={fmtPct(dato.pct_sin_retrocesos)} foot="pasaron por el flujo sin volver atrás" tono="verde" />
            <Kpi label="Costo de un retroceso" value={costo == null ? '—' : `${costo > 0 ? '+' : ''}${costo.toFixed(1)} HH`} foot="Lead Time mediano con retrocesos menos sin retrocesos" tono="rojo" />
            <Kpi label="Tipo más lento" value={tipoMasLento?.grupo ?? '—'} foot={tipoMasLento ? `Lead Time mediano ${fmtH(tipoMasLento.mediana)}` : ''} tono="naranja" />
            <Kpi
              label="N° de pendientes generados"
              value={pend ? nf(pend.veces) : '—'}
              foot={pend ? `veces en estado PENDIENTES · ${nf(pend.solicitudes_con)} de ${nf(pend.solicitudes_total)} solicitudes` : 'falta ejecutar la migración 0019'}
              tono="navy"
            />
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Por tipo de solicitud</h2>
              <p className="sub">Lead Time mediano de formalización y % dentro del SLA (grupos con {MIN_N}+ formalizadas)</p>
              {dato.tipo?.length ? <Barras items={dato.tipo} sla={sla} /> : <p className="sub">Faltan datos para comparar.</p>}
            </div>
            <div className="tarjeta-seccion">
              <h2>Por canal</h2>
              <p className="sub">Lead Time mediano de formalización y % dentro del SLA (grupos con {MIN_N}+ formalizadas)</p>
              {dato.canal?.length ? <Barras items={dato.canal} sla={sla} /> : <p className="sub">Faltan datos para comparar.</p>}
            </div>
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Lead Time mediano según día y hora de creación</h2>
              <p className="sub">Las celdas más oscuras son las franjas en que crear una solicitud sale más caro</p>
              <Grafico
                height={320}
                data={[{
                  type: 'heatmap', x: Array.from({ length: 12 }, (_, i) => `${i + 7}h`), y: DIAS,
                  z: DIAS.map((_, di) => Array.from({ length: 12 }, (_, i) => dato.heat?.find((h) => h.dia === di + 1 && h.hora === i + 7)?.mediana ?? null)),
                  colorscale: [[0, '#EDF5EC'], [0.5, PALETA.verde], [1, PALETA.navy]], colorbar: { title: { text: 'HH' }, thickness: 14 },
                  hovertemplate: '%{y} %{x}: %{z:.1f} HH<extra></extra>',
                }]}
                layout={{ yaxis: { autorange: 'reversed' }, margin: { t: 16 } }}
              />
            </div>
            <div className="tarjeta-seccion">
              <h2>Impacto de los retrocesos</h2>
              <p className="sub">Distribución del Lead Time de formalización: % de cada grupo por tramo de {ANCHO} HH. Líneas: medianas y SLA.</p>
              {hayDist ? (
                <Grafico
                  height={320}
                  data={[
                    { type: 'bar', name: `Sin retrocesos (${nf(dist!.n_sin)})`, x: TRAMOS, y: serieDist('sin'), marker: { color: PALETA.verde }, opacity: 0.75, hovertemplate: 'Sin retrocesos · %{x} HH: %{y:.1%}<extra></extra>' },
                    { type: 'bar', name: `Con retrocesos (${nf(dist!.n_con)})`, x: TRAMOS, y: serieDist('con'), marker: { color: PALETA.rojo }, opacity: 0.6, hovertemplate: 'Con retrocesos · %{x} HH: %{y:.1%}<extra></extra>' },
                  ]}
                  layout={{
                    barmode: 'overlay', bargap: 0.08,
                    yaxis: { tickformat: '.0%', title: { text: '% del grupo' } },
                    xaxis: { title: { text: 'Lead Time de formalización (HH)' }, type: 'category', tickangle: -45 },
                    shapes: [
                      ...([['sin', PALETA.verde], ['con', PALETA.rojo]] as const).flatMap(([g, c]) => {
                        const x = posTramo(g === 'sin' ? dist!.med_sin : dist!.med_con)
                        return x == null ? [] : [{ type: 'line', x0: x, x1: x, yref: 'paper', y0: 0, y1: 1, line: { color: c, width: 2 } }]
                      }),
                      { type: 'line', x0: posSla, x1: posSla, yref: 'paper', y0: 0, y1: 1, line: { color: PALETA.gris, dash: 'dash' } },
                    ],
                    annotations: [
                      { x: posSla, y: 1, yref: 'paper', text: `SLA ${sla}`, showarrow: false, yanchor: 'bottom', font: { size: 11 } },
                    ],
                  }}
                />
              ) : <p className="sub">Sin datos suficientes de ambos grupos para comparar.</p>}
              {hayDist && (
                <p className="sub">Mediana sin retrocesos {fmtH(dist!.med_sin)} · con retrocesos {fmtH(dist!.med_con)}.</p>
              )}
            </div>
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Tendencia mensual</h2>
              <p className="sub">Solicitudes creadas por resultado (barras) y conversión a formalizada (línea)</p>
              <Grafico
                height={360}
                data={[
                  ...tendRes.map((r) => ({ type: 'bar', name: r.replace('_', ' '), x: tendMeses, y: tendMeses.map((m) => dato.tendencia?.find((t) => t.mes === m && t.resultado === r)?.n ?? 0), marker: { color: RES_COLOR[r] } })),
                  { type: 'scatter', mode: 'lines+markers+text', name: 'Conversión', x: tendMeses, y: tendMeses.map((m) => dato.conversion_mes?.find((c) => c.mes === m)?.conv ?? null), yaxis: 'y2', text: tendMeses.map((m) => fmtPct(dato.conversion_mes?.find((c) => c.mes === m)?.conv)), textposition: 'top center', line: { color: PALETA.navy, width: 2 } },
                ]}
                layout={{ barmode: 'stack', yaxis2: { overlaying: 'y', side: 'right', tickformat: '.0%', range: [0, 1.15], showgrid: false }, xaxis: { dtick: 'M1', tickformat: '%b %Y' } }}
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
                        <td><span className="barra-mini" style={{ width: `${(r.veces / max) * 100}%` }} /> {nf(r.veces)}</td>
                        <td>{nf(r.solicitudes)}</td>
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
              {(['sucursal', 'usuario'] as const).map((d) => (
                <button key={d} type="button" className={dimension === d ? 'pestana activa' : 'pestana'} onClick={() => setDimension(d)}>
                  {d === 'usuario' ? 'Usuario que crea' : 'Sucursal'}
                </button>
              ))}
            </div>
            {dato.ranking?.length ? (
              <div className="tabla-scroll">
                <table>
                  <thead><tr><th>Grupo</th><th>Creadas</th><th>Formalizadas</th><th>Conversión</th><th>Lead Time mediano (HH)</th><th>% SLA</th></tr></thead>
                  <tbody>{dato.ranking.map((r) => (
                    <tr key={r.grupo}><td>{r.grupo}</td><td>{r.creadas}</td><td>{r.formalizadas}</td><td>{fmtPct(r.conversion)}</td><td>{r.mediana.toFixed(1)}</td><td>{fmtPct(r.sla)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className="sub">Sin grupos con suficientes formalizadas.</p>}
          </div>

          <LeadTimeMes idPais={pais.id_pais} sla={sla} desde={desde} hasta={hasta} tipo={tipo} />

          <div className="preguntas">
            <h2>Preguntas y respuestas</h2>
            <div className="preguntas-grid">
              {costo != null && (
                <div className="qa"><b>¿Cuánto cuesta un retroceso?</b>{`Las formalizadas con retrocesos tienen un Lead Time mediano ${Math.abs(costo).toFixed(1)} HH hábiles ${costo > 0 ? 'mayor' : 'menor'}; ${fmtPct(dato.pct_sin_retrocesos == null ? null : 1 - dato.pct_sin_retrocesos)} de las formalizadas tuvo al menos uno.`}</div>
              )}
              {tipoMasLento && (
                <div className="qa"><b>¿Qué tipo de solicitud tarda más?</b>{`«${tipoMasLento.grupo}» (Lead Time mediano ${fmtH(tipoMasLento.mediana)}, SLA ${fmtPct(tipoMasLento.sla)}) es el más lento.`}</div>
              )}
              {dato.retrocesos?.[0] && (
                <div className="qa"><b>¿Cuál es el retroceso más común?</b>{`De «${dato.retrocesos[0].desde}» a «${dato.retrocesos[0].hacia}»: ${nf(dato.retrocesos[0].veces)} veces en ${nf(dato.retrocesos[0].solicitudes)} solicitudes.`}</div>
              )}
              {pend && pend.solicitudes_total > 0 && (
                <div className="qa"><b>¿Cuánto pesan los pendientes?</b>{`Se generaron ${nf(pend.veces)} pendientes en ${nf(pend.solicitudes_con)} solicitudes (${fmtPct(pend.solicitudes_con / pend.solicitudes_total)} del periodo), ${(pend.solicitudes_con ? pend.veces / pend.solicitudes_con : 0).toFixed(1)} por solicitud que pasó por PENDIENTES.`}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
