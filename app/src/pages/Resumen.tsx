import { useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'
import LeadTimeMes from '../components/LeadTimeMes'

// Resumen: cifras agregadas por mes, tipo y resultado (tabla resumen_mensual). Sin datos por solicitud.
type Fila = {
  mes: string; tipo_solicitud: string; resultado_final: string; creadas: number; formalizadas: number
  suma_hh_formalizado: number; dentro_sla: number; hasta_8_hh: number; de_8_a_16_hh: number
  de_16_a_24_hh: number; mas_de_24_hh: number
}
const SLA_HH = 24
const TODOS = '__todos__'
const RES_COLOR: Record<string, string> = {
  EXITOSA: PALETA.verde, RECHAZADA: PALETA.rojo, DESERCION: PALETA.naranja, EN_PROCESO: PALETA.cielo,
  ESTANCADA: PALETA.amarillo, SOLO_UN_ESTADO: '#9AA6C4',
}
const fmtNum = (n: number) => n.toLocaleString('es-CR')
const fmtPct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—')
const fmtHH = (x: number | null) => (x == null ? '—' : `${x.toFixed(1)} HH`)
const etiquetaMes = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('es-CR', { month: 'short', year: 'numeric' })
const pc = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—')

export default function Resumen() {
  const { pais } = useOutletContext<{ pais: { id_pais: number; nombre: string } }>()
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tipo, setTipo] = useState(TODOS)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.from('resumen_mensual')
      .select('mes, tipo_solicitud, resultado_final, creadas, formalizadas, suma_hh_formalizado, dentro_sla, hasta_8_hh, de_8_a_16_hh, de_16_a_24_hh, mas_de_24_hh')
      .eq('id_pais', pais.id_pais)
      .order('mes')
      .then(({ data, error: err }) => {
        if (!vivo) return
        if (err) setError('No se pudieron cargar las cifras: ' + err.message)
        setFilas((data as Fila[]) ?? [])
        setCargando(false)
      })
    return () => { vivo = false }
  }, [pais.id_pais])

  const meses = useMemo(() => [...new Set(filas.map((x) => x.mes))].sort(), [filas])
  const tipos = useMemo(() => [...new Set(filas.map((x) => x.tipo_solicitud))].sort(), [filas])
  const mDesde = desde || meses[0] || ''
  const mHasta = hasta || meses[meses.length - 1] || ''
  const f = useMemo(
    () => filas.filter((x) => x.mes >= mDesde && x.mes <= mHasta && (tipo === TODOS || x.tipo_solicitud === tipo)),
    [filas, mDesde, mHasta, tipo],
  )

  if (cargando) return <div className="resumen"><Cabecera kicker="Resumen" titulo="Formalizar a tiempo también es Impactar Vidas" pose="prestamito_corriendo" /><p className="cargando">Cargando cifras de {pais.nombre}…</p></div>
  if (error) return <p className="error">{error}</p>
  if (filas.length === 0) {
    return (
      <div className="resumen">
        <Cabecera kicker="Resumen" titulo="Formalizar a tiempo también es Impactar Vidas" pose="prestamito_pensando" />
        <div className="vacio"><h2>Sin cifras para {pais.nombre}</h2><p>Todavía no hay datos cargados para este país.</p></div>
      </div>
    )
  }

  const sum = (fn: (x: Fila) => number) => f.reduce((a, x) => a + fn(x), 0)
  const creadas = sum((x) => x.creadas)
  const formalizadas = sum((x) => x.formalizadas)
  const sumaHH = sum((x) => x.suma_hh_formalizado)
  const dentro = sum((x) => x.dentro_sla)
  const rangos = [sum((x) => x.hasta_8_hh), sum((x) => x.de_8_a_16_hh), sum((x) => x.de_16_a_24_hh), sum((x) => x.mas_de_24_hh)]
  const limites = [8, 16, 24]
  function percentil(q: number): number | null {
    const obj = q * formalizadas
    let acum = 0
    let lo = 0
    for (let i = 0; i < rangos.length; i++) {
      const n = rangos[i]
      const hi = i < limites.length ? limites[i] : Infinity
      if (n > 0 && acum + n >= obj) return hi === Infinity ? null : lo + ((obj - acum) / n) * (hi - lo)
      acum += n
      lo = hi
    }
    return null
  }
  const mediana = formalizadas ? percentil(0.5) : null
  const p90 = formalizadas ? percentil(0.9) : null

  // Series mensuales para mini gráficos y tendencia
  const mesesF = [...new Set(f.map((x) => x.mes))].sort()
  const serie = mesesF.map((m) => {
    const fm = f.filter((x) => x.mes === m)
    const c = fm.reduce((a, x) => a + x.creadas, 0)
    const fo = fm.reduce((a, x) => a + x.formalizadas, 0)
    const hh = fm.reduce((a, x) => a + x.suma_hh_formalizado, 0)
    const d = fm.reduce((a, x) => a + x.dentro_sla, 0)
    const ex = fm.filter((x) => x.resultado_final === 'EXITOSA').reduce((a, x) => a + x.creadas, 0)
    return { mes: m, creadas: c, formalizadas: fo, prom: fo ? hh / fo : NaN, sla: fo ? d / fo : NaN, conv: c ? ex / c : NaN }
  })

  const porRes = [...new Set(f.map((x) => x.resultado_final))]
  const noFormal = (r: string) => sum((x) => (x.resultado_final === r ? x.creadas : 0))
  const dona = porRes.map((r) => ({ r, n: noFormal(r) })).filter((x) => x.n > 0)
  const abiertas = ['EN_PROCESO', 'ESTANCADA', 'SOLO_UN_ESTADO'].reduce((a, r) => a + noFormal(r), 0)

  return (
    <div className="resumen">
      <Cabecera
        kicker="Resumen · Tiempos de formalización"
        titulo="Formalizar a tiempo también es Impactar Vidas"
        sub={`Solicitudes creadas de ${etiquetaMes(mDesde)} a ${etiquetaMes(mHasta)}. Cifras por mes.`}
        pose="prestamito_corriendo"
      />

      <div className="filtros-resumen">
        <label>Desde<select value={mDesde} onChange={(e) => setDesde(e.target.value)}>{meses.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}</select></label>
        <label>Hasta<select value={mHasta} onChange={(e) => setHasta(e.target.value)}>{meses.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}</select></label>
        <label>Tipo de solicitud<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value={TODOS}>Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      </div>

      <div className="kpis">
        <Kpi label="Solicitudes creadas" value={fmtNum(creadas)} foot={`${fmtNum(formalizadas)} formalizadas · ${fmtNum(abiertas)} abiertas`} tono="navy" spark={serie.map((x) => x.creadas)} />
        <Kpi label="Promedio hábil a formalización" value={fmtHH(formalizadas ? sumaHH / formalizadas : null)} tono="cielo" spark={serie.map((x) => x.prom)} />
        <Kpi label={`Formalizadas en ≤ ${SLA_HH} HH`} value={fmtPct(formalizadas ? dentro / formalizadas : NaN)} tono="verde" relleno spark={serie.map((x) => x.sla)} />
        <Kpi label="Mediana hábil (aprox.)" value={mediana == null ? `> ${SLA_HH} HH` : fmtHH(mediana)} foot="estimada por rangos" tono="verde" />
        <Kpi label="P90, el 10% más lento (aprox.)" value={p90 == null ? `> ${SLA_HH} HH` : fmtHH(p90)} foot="estimado por rangos" tono="naranja" />
        <Kpi label="Conversión a formalizada" value={fmtPct(creadas ? formalizadas / creadas : NaN)} foot={`Rechazo ${pc(noFormal('RECHAZADA'), creadas)} · Deserción ${pc(noFormal('DESERCION'), creadas)}`} tono="lima" spark={serie.map((x) => x.conv)} />
      </div>

      <div className="grid-dos">
        <div className="tarjeta-seccion">
          <h2>Solicitudes por mes y resultado</h2>
          <p className="sub">Todas las solicitudes creadas en el periodo, con la conversión a formalizada</p>
          <Grafico
            height={320}
            data={[
              ...porRes.map((r) => ({
                type: 'bar', name: r.replace('_', ' '), x: mesesF,
                y: mesesF.map((m) => sum((x) => (x.mes === m && x.resultado_final === r ? x.creadas : 0))),
                marker: { color: RES_COLOR[r] },
              })),
              {
                type: 'scatter', mode: 'lines+markers+text', name: 'Conversión', x: mesesF, y: serie.map((x) => x.conv),
                yaxis: 'y2', text: serie.map((x) => (Number.isFinite(x.conv) ? `${Math.round(x.conv * 100)}%` : '')),
                textposition: 'top center', line: { color: PALETA.navy, width: 2 },
              },
            ]}
            layout={{ barmode: 'stack', yaxis2: { overlaying: 'y', side: 'right', tickformat: '.0%', range: [0, 1.05], showgrid: false }, xaxis: { dtick: 'M1', tickformat: '%b %Y' } }}
          />
        </div>
        <div className="tarjeta-seccion">
          <h2>Resultado final</h2>
          <p className="sub">Distribución de las solicitudes del periodo</p>
          <Grafico
            height={320}
            data={[{ type: 'pie', hole: 0.6, sort: false, labels: dona.map((x) => x.r.replace('_', ' ')), values: dona.map((x) => x.n), marker: { colors: dona.map((x) => RES_COLOR[x.r]) }, textinfo: 'percent' }]}
            layout={{ margin: { l: 8, r: 8, t: 20, b: 8 } }}
          />
        </div>
      </div>

      <div className="grid-dos">
        <div className="tarjeta-seccion">
          <h2>Horas hábiles a formalizar</h2>
          <p className="sub">Cuántas formalizadas caen en cada rango</p>
          <Grafico
            height={300}
            data={[{
              type: 'bar', x: ['≤ 8 HH', '8–16 HH', '16–24 HH', '> 24 HH'], y: rangos,
              text: rangos.map((n) => (formalizadas ? `${Math.round((n / formalizadas) * 100)}%` : '')),
              textposition: 'outside', marker: { color: [PALETA.verde, PALETA.cielo, PALETA.amarillo, PALETA.rojo] },
            }]}
            layout={{ yaxis: { title: { text: 'Solicitudes' } }, showlegend: false }}
          />
        </div>
        <div className="tarjeta-seccion">
          <h2>Por mes</h2>
          <table>
            <thead><tr><th>Mes</th><th>Creadas</th><th>Formalizadas</th><th>Promedio HH</th><th>% SLA</th></tr></thead>
            <tbody>{serie.map((x) => (
              <tr key={x.mes}>
                <td>{etiquetaMes(x.mes)}</td><td>{fmtNum(x.creadas)}</td><td>{fmtNum(x.formalizadas)}</td>
                <td>{fmtHH(Number.isFinite(x.prom) ? x.prom : null)}</td><td>{fmtPct(x.sla)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <LeadTimeMes idPais={pais.id_pais} sla={SLA_HH} />

      <div className="preguntas">
        <h2>Preguntas y respuestas</h2>
        <div className="preguntas-grid">
          <div className="qa"><b>{`¿Cumplimos el SLA de ${SLA_HH} horas hábiles?`}</b>{`${fmtPct(formalizadas ? dentro / formalizadas : NaN)} de las formalizadas está dentro del SLA.`}</div>
          <div className="qa"><b>¿Qué pasa con las que no se formalizan?</b>{`De ${fmtNum(creadas)} solicitudes creadas, ${pc(formalizadas, creadas)} se formalizan, ${pc(noFormal('RECHAZADA'), creadas)} se rechazan, ${pc(noFormal('DESERCION'), creadas)} desisten y ${fmtNum(abiertas)} siguen abiertas.`}</div>
          <div className="qa"><b>¿Cuánto tardamos en formalizar?</b>{mediana == null ? `La mediana supera ${SLA_HH} HH hábiles.` : `La mediana aproximada es de ${fmtHH(mediana)} hábiles; el 90% se formaliza en ${p90 == null ? `más de ${SLA_HH} HH` : fmtHH(p90)} o menos.`}</div>
        </div>
      </div>
    </div>
  )
}
