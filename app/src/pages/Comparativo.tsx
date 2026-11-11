import { useEffect, useMemo, useState } from 'react'
import { sb } from '../lib/supabase'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'

// Comparativo regional: todos los países en una sola vista (overview e insights).
// Usa solo cifras agregadas (resumen_mensual). Los tiempos salen de las formalizadas.
type Fila = {
  id_pais: number; mes: string; tipo_solicitud: string; resultado_final: string; creadas: number
  formalizadas: number; suma_hh_formalizado: number; dentro_sla: number
  hasta_8_hh: number; de_8_a_16_hh: number; de_16_a_24_hh: number; mas_de_24_hh: number
}
type Pais = { id_pais: number; codigo: string; nombre: string }

const SLA_HH = 24
const MIN_N = 5
const COLOR_PAIS = [PALETA.verde, PALETA.cielo, PALETA.naranja, PALETA.navy]
const fmtNum = (n: number) => n.toLocaleString('es-CR')
const fmtPct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—')
const fmtHH = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} HH` : '—')
const etiquetaMes = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('es-CR', { month: 'short', year: 'numeric' })

export default function Comparativo() {
  const [filas, setFilas] = useState<Fila[]>([])
  const [paises, setPaises] = useState<Pais[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [tipo, setTipo] = useState('')

  useEffect(() => {
    let vivo = true
    Promise.all([
      sb.from('resumen_mensual').select('id_pais, mes, tipo_solicitud, resultado_final, creadas, formalizadas, suma_hh_formalizado, dentro_sla, hasta_8_hh, de_8_a_16_hh, de_16_a_24_hh, mas_de_24_hh'),
      sb.from('pais').select('id_pais, codigo, nombre').order('id_pais'),
    ]).then(([r1, r2]) => {
      if (!vivo) return
      if (r1.error || r2.error) setError('No se pudieron cargar las cifras: ' + (r1.error?.message ?? r2.error?.message))
      setFilas((r1.data as Fila[]) ?? [])
      setPaises((r2.data as Pais[]) ?? [])
      setCargando(false)
    })
    return () => { vivo = false }
  }, [])

  const meses = useMemo(() => [...new Set(filas.map((f) => f.mes))].sort(), [filas])
  const tipos = useMemo(() => [...new Set(filas.map((f) => f.tipo_solicitud))].sort(), [filas])
  const mDesde = desde || meses[0] || ''
  const mHasta = hasta || meses[meses.length - 1] || ''
  const f = useMemo(
    () => filas.filter((x) => x.mes >= mDesde && x.mes <= mHasta && (!tipo || x.tipo_solicitud === tipo)),
    [filas, mDesde, mHasta, tipo],
  )

  if (cargando) return <div className="resumen"><Cabecera kicker="Comparativo regional" titulo="Todos los países, una sola mirada" pose="prestamito_explicando" /><p className="cargando">Cargando comparativo…</p></div>
  if (error) return <p className="error">{error}</p>

  // Totales por país
  const nombrePais = (id: number) => paises.find((p) => p.id_pais === id)?.nombre ?? `País ${id}`
  const idsPaises = [...new Set(f.map((x) => x.id_pais))].sort((a, b) => a - b)
  const agg = (rows: Fila[]) => {
    const creadas = rows.reduce((a, x) => a + x.creadas, 0)
    const formal = rows.reduce((a, x) => a + x.formalizadas, 0)
    const hh = rows.reduce((a, x) => a + Number(x.suma_hh_formalizado), 0)
    const dentro = rows.reduce((a, x) => a + x.dentro_sla, 0)
    const exitosa = rows.filter((x) => x.resultado_final === 'EXITOSA').reduce((a, x) => a + x.creadas, 0)
    const rech = rows.filter((x) => x.resultado_final === 'RECHAZADA').reduce((a, x) => a + x.creadas, 0)
    const des = rows.filter((x) => x.resultado_final === 'DESERCION').reduce((a, x) => a + x.creadas, 0)
    const rangos = [0, 1, 2, 3].map((i) => rows.reduce((a, x) => a + [x.hasta_8_hh, x.de_8_a_16_hh, x.de_16_a_24_hh, x.mas_de_24_hh][i], 0))
    return { creadas, formal, prom: formal ? hh / formal : NaN, sla: formal ? dentro / formal : NaN,
      conv: creadas ? exitosa / creadas : NaN, rech: creadas ? rech / creadas : NaN, des: creadas ? des / creadas : NaN, rangos }
  }
  const porPais = idsPaises.map((id) => ({ id, nombre: nombrePais(id), ...agg(f.filter((x) => x.id_pais === id)) }))
  const total = agg(f)
  const nombres = porPais.map((p) => p.nombre)
  const colores = porPais.map((p) => COLOR_PAIS[p.id % COLOR_PAIS.length])

  // Lead time mensual por país (mínimo 5 formalizadas por mes)
  const mesesF = [...new Set(f.map((x) => x.mes))].sort()
  const leadTrazas = idsPaises.map((id, i) => {
    const x: string[] = [], y: number[] = []
    for (const m of mesesF) {
      const rows = f.filter((r) => r.id_pais === id && r.mes === m)
      const a = agg(rows)
      if (a.formal >= MIN_N) { x.push(m); y.push(a.prom) }
    }
    return { type: 'scatter', mode: 'lines+markers', name: nombrePais(id), x, y, line: { color: COLOR_PAIS[id % COLOR_PAIS.length], width: 3 }, marker: { size: 8, color: COLOR_PAIS[i % COLOR_PAIS.length] } }
  })

  // Tipo: promedio HH por tipo y país (mínimo 5 formalizadas)
  const tiposF = [...new Set(f.map((x) => (x.tipo_solicitud === 'PERSONAL' ? 'NO ASALARIADO' : x.tipo_solicitud)))].sort()
  const tipoTrazas = idsPaises.map((id) => {
    const y = tiposF.map((t) => {
      const rows = f.filter((r) => r.id_pais === id && (r.tipo_solicitud === t || (t === 'NO ASALARIADO' && r.tipo_solicitud === 'PERSONAL')))
      const a = agg(rows)
      return a.formal >= MIN_N ? a.prom : null
    })
    return { type: 'bar', name: nombrePais(id), x: tiposF, y, marker: { color: COLOR_PAIS[id % COLOR_PAIS.length] } }
  })

  const rangosNombres = ['≤ 8 HH', '8–16 HH', '16–24 HH', '> 24 HH']
  const rangosTrazas = rangosNombres.map((r, i) => ({
    type: 'bar', name: r, x: nombres,
    y: porPais.map((p) => (p.formal ? p.rangos[i] / p.formal : 0)),
    marker: { color: [PALETA.verde, PALETA.cielo, PALETA.amarillo, PALETA.rojo][i] },
  }))

  const resultados = ['EXITOSA', 'RECHAZADA', 'DESERCION', 'EN_PROCESO', 'ESTANCADA', 'SOLO_UN_ESTADO']
  const resColor: Record<string, string> = { EXITOSA: PALETA.verde, RECHAZADA: PALETA.rojo, DESERCION: PALETA.naranja, EN_PROCESO: PALETA.cielo, ESTANCADA: PALETA.amarillo, SOLO_UN_ESTADO: '#9AA6C4' }
  const resTrazas = resultados.map((r) => ({
    type: 'bar', name: r.replace('_', ' '), x: nombres,
    y: idsPaises.map((id) => {
      const rows = f.filter((x) => x.id_pais === id)
      const c = rows.reduce((a, x) => a + x.creadas, 0)
      return c ? rows.filter((x) => x.resultado_final === r).reduce((a, x) => a + x.creadas, 0) / c : 0
    }),
    marker: { color: resColor[r] },
  }))

  return (
    <div className="resumen">
      <Cabecera kicker="Comparativo regional" titulo="Todos los países, una sola mirada" sub="Overview e insights de Costa Rica, Panamá, Nicaragua y El Salvador. Tiempos solo de formalizadas." pose="prestamito_explicando" />

      <div className="filtros-resumen">
        <label>Desde<select value={mDesde} onChange={(e) => setDesde(e.target.value)}>{meses.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}</select></label>
        <label>Hasta<select value={mHasta} onChange={(e) => setHasta(e.target.value)}>{meses.map((m) => <option key={m} value={m}>{etiquetaMes(m)}</option>)}</select></label>
        <label>Tipo de solicitud<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      </div>

      <h2 className="seccion">Overview</h2>
      <div className="kpis">
        <Kpi label="Solicitudes creadas (todos)" value={fmtNum(total.creadas)} foot={`${fmtNum(total.formal)} formalizadas`} tono="navy" />
        <Kpi label="Conversión regional" value={fmtPct(total.conv)} tono="verde" relleno />
        <Kpi label="Promedio HH a formalizar" value={fmtHH(total.prom)} tono="cielo" />
        <Kpi label={`Dentro del SLA (${SLA_HH} HH)`} value={fmtPct(total.sla)} tono="lima" />
      </div>

      <div className="tarjeta-seccion">
        <h2>Comparativo por país</h2>
        <div className="tabla-scroll">
          <table>
            <thead><tr><th>País</th><th>Creadas</th><th>Formalizadas</th><th>Conversión</th><th>Rechazo</th><th>Deserción</th><th>Promedio HH</th><th>% SLA</th></tr></thead>
            <tbody>{porPais.map((p) => (
              <tr key={p.id}><td><strong>{p.nombre}</strong></td><td>{fmtNum(p.creadas)}</td><td>{fmtNum(p.formal)}</td>
                <td>{fmtPct(p.conv)}</td><td>{fmtPct(p.rech)}</td><td>{fmtPct(p.des)}</td><td>{fmtHH(p.prom)}</td><td>{fmtPct(p.sla)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="grid-dos">
        <div className="tarjeta-seccion">
          <h2>Solicitudes creadas por país</h2>
          <Grafico height={300} data={[{ type: 'bar', x: nombres, y: porPais.map((p) => p.creadas), marker: { color: colores }, text: porPais.map((p) => fmtNum(p.creadas)), textposition: 'outside' }]} layout={{ showlegend: false }} />
        </div>
        <div className="tarjeta-seccion">
          <h2>Conversión a formalizada</h2>
          <Grafico height={300} data={[{ type: 'bar', x: nombres, y: porPais.map((p) => p.conv), marker: { color: colores }, text: porPais.map((p) => fmtPct(p.conv)), textposition: 'outside' }]} layout={{ showlegend: false, yaxis: { tickformat: '.0%' } }} />
        </div>
      </div>

      <div className="tarjeta-seccion">
        <h2>Resultado final por país</h2>
        <p className="sub">Participación de cada resultado en las solicitudes creadas</p>
        <Grafico height={320} data={resTrazas} layout={{ barmode: 'stack', yaxis: { tickformat: '.0%' } }} />
      </div>

      <h2 className="seccion">Insights</h2>
      <div className="grid-dos">
        <div className="tarjeta-seccion">
          <h2>Lead time promedio por mes</h2>
          <p className="sub">Horas hábiles promedio a formalización, por país (meses con {MIN_N}+ formalizadas)</p>
          <Grafico height={320} data={leadTrazas} layout={{ xaxis: { dtick: 'M1', tickformat: '%b %Y' }, yaxis: { title: { text: 'HH' } }, shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: SLA_HH, y1: SLA_HH, line: { color: PALETA.gris, dash: 'dash' } }] }} />
        </div>
        <div className="tarjeta-seccion">
          <h2>Horas hábiles a formalizar</h2>
          <p className="sub">Participación de cada rango por país</p>
          <Grafico height={320} data={rangosTrazas} layout={{ barmode: 'group', yaxis: { tickformat: '.0%' } }} />
        </div>
      </div>

      <div className="tarjeta-seccion">
        <h2>Promedio HH por tipo de solicitud</h2>
        <p className="sub">Cada tipo por país (mínimo {MIN_N} formalizadas; PERSONAL se suma a NO ASALARIADO)</p>
        <Grafico height={340} data={tipoTrazas} layout={{ barmode: 'group', yaxis: { title: { text: 'HH' } }, shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: SLA_HH, y1: SLA_HH, line: { color: PALETA.gris, dash: 'dash' } }] }} />
      </div>
    </div>
  )
}
