import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { periodoPorDefecto } from '../lib/fechas'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'

// Cuellos y reprocesos. Cálculos en la base (función cuellos).
type Estado = { estado: string; solicitudes: number; mediana: number; p90: number; horas: number; share: number }
type Resultado = {
  solicitudes_periodo: number
  pct_con_retrocesos: number | null
  retrocesos_promedio: number | null
  pct_cliente_reprocesado: number | null
  estados: Estado[]
}

const fmtPct = (x: number | null | undefined) => (x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`)
const fmtNum = (n: number) => n.toLocaleString('es-CR')

export default function Cuellos() {
  const { pais } = useOutletContext<{ pais: { id_pais: number; nombre: string } }>()
  const [desde, setDesde] = useState(periodoPorDefecto().desde)
  const [hasta, setHasta] = useState(periodoPorDefecto().hasta)
  const [tipo, setTipo] = useState('')
  const [canal, setCanal] = useState('')
  const [datos, setDatos] = useState<Resultado | null>(null)
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
    sb.rpc('cuellos', {
      p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta,
      p_tipos: tipo ? [tipo] : null, p_canales: canal ? [canal] : null, p_resultados: ['EXITOSA'],
    }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo calcular: ' + err.message)
      else setDatos(data as Resultado)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, desde, hasta, tipo, canal])

  if (error) return <p className="error">{error}</p>

  const estados = datos?.estados ?? []
  const top = estados[0]

  return (
    <div className="resumen">
      <Cabecera kicker="Cuellos y reprocesos" titulo="Dónde se nos va el tiempo (y cómo recuperarlo)" sub="Dónde se va el tiempo hábil hasta la formalización. Los estados posteriores a aprobado informa quedan fuera del análisis." pose="prestamito_estrategia" />

      <div className="filtros-resumen">
        <label>Desde<input type="date" lang="es-CR" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" lang="es-CR" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <label>Tipo de solicitud<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Canal<select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="">Todos</option>{canales.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>

      {cargando && <p className="cargando">Calculando cuellos de {pais.nombre}…</p>}

      {!cargando && datos && (
        <>
          <div className="kpis">
            <Kpi label="Estado que más tiempo consume" value={top ? top.estado : '—'} foot={top ? `${(top.share * 100).toFixed(0)}% de las horas hábiles` : ''} tono="rojo" />
            <Kpi label="Solicitudes con retrocesos" value={fmtPct(datos.pct_con_retrocesos)} foot="volvieron a un estado ya visitado" tono="naranja" />
            <Kpi label="Retrocesos por solicitud" value={datos.retrocesos_promedio == null ? '—' : datos.retrocesos_promedio.toFixed(2)} foot="promedio" tono="verde" />
            <Kpi label="Clientes con más de una solicitud" value={fmtPct(datos.pct_cliente_reprocesado)} foot="en el periodo cargado" tono="navy" />
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>% de las horas hábiles, por estado</h2>
              <p className="sub">Participación de cada estado en el tiempo total del proceso</p>
              {estados.length === 0 ? <p className="sub">Sin estados con estos filtros.</p> : (
                <Grafico
                  height={Math.max(300, 30 * estados.length + 80)}
                  data={[{
                    type: 'bar', orientation: 'h', x: [...estados].reverse().map((e) => e.share), y: [...estados].reverse().map((e) => e.estado),
                    text: [...estados].reverse().map((e) => `${(e.share * 100).toFixed(0)}%`), textposition: 'auto',
                    marker: { color: PALETA.verde }, hovertemplate: '%{y}: %{x:.1%}<extra></extra>',
                  }]}
                  layout={{ xaxis: { tickformat: '.0%' }, showlegend: false, margin: { l: 8, r: 16, t: 16, b: 30 } }}
                />
              )}
            </div>
            <div className="tarjeta-seccion">
              <h2>Tiempo por estado (HH)</h2>
              <p className="sub">Mediana y P90 de cada paso</p>
              <table>
                <thead><tr><th>Estado</th><th>Solicitudes</th><th>Mediana</th><th>P90</th></tr></thead>
                <tbody>{estados.map((e) => {
                  const maxP90 = Math.max(...estados.map((x) => x.p90), 1)
                  return (
                    <tr key={e.estado}>
                      <td>{e.estado}</td><td>{fmtNum(e.solicitudes)}</td><td>{e.mediana.toFixed(1)}</td>
                      <td><span className="barra-mini" style={{ width: `${(e.p90 / maxP90) * 60}px` }} /> {e.p90.toFixed(1)}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
