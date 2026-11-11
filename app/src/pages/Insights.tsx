import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { Cabecera } from '../components/ui'
import LeadTimeMes from '../components/LeadTimeMes'


type Grupo = { grupo: string; formalizadas: number; mediana: number; p90: number; sla: number }
type Ranking = { grupo: string; creadas: number; formalizadas: number; conversion: number; mediana: number; sla: number }
type Dato = {
  n_formalizadas: number
  pct_sin_retrocesos: number | null
  costo_retroceso: number | null
  tipo: Grupo[] | null
  canal: Grupo[] | null
  dia: (Grupo & { orden: number })[] | null
  heat: { dia: number; hora: number; mediana: number }[] | null
  ranking: Ranking[] | null
  tendencia: { mes: string; resultado: string; n: number }[] | null
  conversion_mes: { mes: string; conv: number }[] | null
  retrocesos: { desde: string; hacia: string; veces: number; solicitudes: number }[] | null
  creadas: number
}

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MIN_N = 5
const fmtH = (h: number | null | undefined) => (h == null ? '—' : `${h.toFixed(1)} HH`)
const fmtPct = (x: number | null | undefined) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`)
const etiquetaMes = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es-CR', { month: 'short', year: 'numeric' })

// Barras horizontales: mediana HH y % dentro del SLA
function Barras({ items, max }: { items: Grupo[]; max: number }) {
  return (
    <>
      {items.map((g) => (
        <div key={g.grupo} className="barra-fila barra-doble">
          <span className="barra-etiqueta">{g.grupo}</span>
          <div className="barra-pista">
            <div className="barra-valor" style={{ width: `${(g.mediana / max) * 100}%` }} />
          </div>
          <span className="barra-numero">{fmtH(g.mediana)} · SLA {fmtPct(g.sla)}</span>
        </div>
      ))}
    </>
  )
}

export default function Insights() {
  const { pais, sla } = useOutletContext<{ pais: { id_pais: number; nombre: string }; sla: number }>()
  const hoy = new Date()
  const hace3 = new Date(hoy)
  hace3.setMonth(hoy.getMonth() - 3)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [desde, setDesde] = useState(iso(hace3))
  const [hasta, setHasta] = useState(iso(hoy))
  const [tipo, setTipo] = useState('')
  const [dimension, setDimension] = useState<'promotor' | 'sucursal' | 'usuario'>('promotor')
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
    return () => {
      vivo = false
    }
  }, [pais.id_pais])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.rpc('insights', {
      p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta,
      p_tipos: tipo ? [tipo] : null, p_canales: null, p_resultados: ['EXITOSA'], p_dimension: dimension, p_sla: sla,
    }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo calcular: ' + err.message)
      else setDato(data as Dato)
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [pais.id_pais, desde, hasta, tipo, dimension, sla])

  if (error) return <p className="error">{error}</p>

  const tipoMasLento = dato?.tipo?.[0]
  const diaMasLento = dato?.dia?.reduce<(Grupo & { orden: number }) | undefined>(
    (acc, d) => (!acc || d.mediana > acc.mediana ? d : acc), undefined)
  const maxTipo = Math.max(...(dato?.tipo?.map((t) => t.mediana) ?? [1]), 1)
  const maxCanal = Math.max(...(dato?.canal?.map((t) => t.mediana) ?? [1]), 1)
  const maxHeat = Math.max(...(dato?.heat?.map((h) => h.mediana) ?? [1]), 1)
  const meses = [...new Set(dato?.tendencia?.map((t) => t.mes) ?? [])].sort()
  const resultados = [...new Set(dato?.tendencia?.map((t) => t.resultado) ?? [])]
  const maxMes = Math.max(...meses.map((m) => (dato?.tendencia ?? []).filter((t) => t.mes === m).reduce((a, t) => a + t.n, 0)), 1)

  return (
    <div className="resumen">
      <Cabecera kicker="Insights" titulo="¿Qué acelera y qué frena una formalización?" sub="Qué explica el tiempo a formalizar." pose="prestamito_pensando" />
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

      {cargando && <p className="cargando">Calculando Insights de {pais.nombre}…</p>}

      {!cargando && dato && (
        <>
          <div className="kpis">
            <div className="kpi"><span>Formalizadas sin retrocesos</span><strong>{fmtPct(dato.pct_sin_retrocesos)}</strong><small>pasaron por el flujo sin volver atrás</small></div>
            <div className="kpi"><span>Costo de un retroceso</span><strong>{dato.costo_retroceso == null ? '—' : `${dato.costo_retroceso > 0 ? '+' : ''}${dato.costo_retroceso.toFixed(1)}h`}</strong><small>mediana con retrocesos menos sin retrocesos</small></div>
            <div className="kpi"><span>Tipo más lento</span><strong className="kpi-texto">{tipoMasLento?.grupo ?? '—'}</strong><small>{tipoMasLento ? `mediana ${fmtH(tipoMasLento.mediana)}` : ''}</small></div>
            <div className="kpi"><span>Día de creación más lento</span><strong className="kpi-texto">{diaMasLento?.grupo ?? '—'}</strong><small>{diaMasLento ? `mediana ${fmtH(diaMasLento.mediana)}` : ''}</small></div>
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Por tipo de solicitud</h2>
              <p className="sub">Mediana HH a formalización y % dentro del SLA (grupos con {MIN_N}+ formalizadas)</p>
              {dato.tipo?.length ? <Barras items={dato.tipo} max={maxTipo} /> : <p className="sub">Faltan datos para comparar.</p>}
            </div>
            <div className="tarjeta-seccion">
              <h2>Por canal</h2>
              <p className="sub">Mediana HH a formalización y % dentro del SLA (grupos con {MIN_N}+ formalizadas)</p>
              {dato.canal?.length ? <Barras items={dato.canal} max={maxCanal} /> : <p className="sub">Faltan datos para comparar.</p>}
            </div>
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Mediana HH según día y hora de creación</h2>
              <p className="sub">Las celdas más oscuras son las franjas en que crear una solicitud sale más caro</p>
              <table className="mapa">
                <thead><tr><th></th>{Array.from({ length: 12 }, (_, i) => <th key={i}>{i + 7}h</th>)}</tr></thead>
                <tbody>
                  {DIAS.map((d, di) => (
                    <tr key={d}>
                      <td>{d}</td>
                      {Array.from({ length: 12 }, (_, i) => {
                        const c = dato.heat?.find((h) => h.dia === di + 1 && h.hora === i + 7)
                        const op = c ? Math.min(c.mediana / maxHeat, 1) : 0
                        return <td key={i} style={{ background: c ? `rgba(6,37,91,${0.12 + op * 0.8})` : 'transparent', color: op > 0.55 ? '#fff' : 'inherit' }}>{c ? c.mediana.toFixed(0) : ''}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tarjeta-seccion">
              <h2>Retrocesos más frecuentes</h2>
              <p className="sub">Pasos que devuelven la solicitud a un estado ya visitado</p>
              {dato.retrocesos?.length ? (
                <table>
                  <thead><tr><th>Desde</th><th>Vuelve a</th><th>Veces</th><th>Solicitudes</th></tr></thead>
                  <tbody>{dato.retrocesos.map((r) => (
                    <tr key={r.desde + r.hacia}><td>{r.desde}</td><td>{r.hacia}</td><td>{r.veces}</td><td>{r.solicitudes}</td></tr>
                  ))}</tbody>
                </table>
              ) : <p className="sub">¡Cero retrocesos en el periodo!</p>}
            </div>
          </div>

          <div className="tarjeta-seccion">
            <h2>Tendencia mensual</h2>
            <p className="sub">Solicitudes creadas por resultado y conversión a formalizada</p>
            <table>
              <thead><tr><th>Mes</th>{resultados.map((r) => <th key={r}>{r.replace('_', ' ')}</th>)}<th>Conversión</th></tr></thead>
              <tbody>{meses.map((m) => (
                <tr key={m}>
                  <td>{etiquetaMes(m)}</td>
                  {resultados.map((r) => <td key={r}>{(dato.tendencia ?? []).find((t) => t.mes === m && t.resultado === r)?.n ?? 0}</td>)}
                  <td>{fmtPct(dato.conversion_mes?.find((c) => c.mes === m)?.conv)}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="sub">Total del periodo: {dato.creadas.toLocaleString('es-CR')} · máximo mensual {maxMes.toLocaleString('es-CR')}</p>
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
        </>
      )}
    </div>
  )
}
