import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'

// Página "Cuellos y reprocesos". Los cálculos se hacen en la base (función public.cuellos).
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

export default function Cuellos({ pais }: { pais: { id_pais: number; nombre: string } }) {
  const hoy = new Date()
  const hace3 = new Date(hoy)
  hace3.setMonth(hoy.getMonth() - 3)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [desde, setDesde] = useState(iso(hace3))
  const [hasta, setHasta] = useState(iso(hoy))
  const [tipo, setTipo] = useState<string>('')
  const [datos, setDatos] = useState<Resultado | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.rpc('cuellos', {
      p_pais: pais.id_pais,
      p_desde: desde,
      p_hasta: hasta,
      p_tipos: tipo ? [tipo] : null,
      p_canales: null,
      p_resultados: ['EXITOSA'],
    }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo calcular: ' + err.message)
      else setDatos(data as Resultado)
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [pais.id_pais, desde, hasta, tipo])

  if (error) return <p className="error">{error}</p>

  const estados = datos?.estados ?? []
  const top = estados[0]
  const maxShare = Math.max(...estados.map((e) => e.share), 0.0001)
  const maxP90 = Math.max(...estados.map((e) => e.p90), 1)

  return (
    <div className="resumen">
      <div className="filtros-resumen">
        <label>
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <label>
          Tipo de solicitud
          <input type="text" value={tipo} placeholder="Todos" onChange={(e) => setTipo(e.target.value.trim())} />
        </label>
      </div>

      {cargando && <p className="cargando">Calculando cuellos de {pais.nombre}…</p>}

      {!cargando && datos && (
        <>
          <div className="kpis">
            <div className="kpi">
              <span>Estado que más tiempo consume</span>
              <strong className="kpi-texto">{top ? top.estado : '—'}</strong>
              <small>{top ? `${(top.share * 100).toFixed(0)}% de las horas hábiles` : ''}</small>
            </div>
            <div className="kpi">
              <span>Solicitudes con retrocesos</span>
              <strong>{fmtPct(datos.pct_con_retrocesos)}</strong>
              <small>volvieron a un estado ya visitado</small>
            </div>
            <div className="kpi">
              <span>Retrocesos por solicitud</span>
              <strong>{datos.retrocesos_promedio == null ? '—' : datos.retrocesos_promedio.toFixed(2)}</strong>
              <small>promedio</small>
            </div>
            <div className="kpi">
              <span>Clientes con más de una solicitud</span>
              <strong>{fmtPct(datos.pct_cliente_reprocesado)}</strong>
              <small>en el periodo cargado</small>
            </div>
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>% de las horas hábiles, por estado</h2>
              <p className="sub">Participación de cada estado en el tiempo total del proceso</p>
              {estados.length === 0 && <p className="sub">Sin estados con estos filtros.</p>}
              {estados.map((e) => (
                <div key={e.estado} className="barra-fila">
                  <span className="barra-etiqueta">{e.estado}</span>
                  <div className="barra-pista">
                    <div className="barra-valor" style={{ width: `${(e.share / maxShare) * 100}%` }} />
                  </div>
                  <span className="barra-numero">{(e.share * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>

            <div className="tarjeta-seccion">
              <h2>Tiempo por estado (HH)</h2>
              <p className="sub">Mediana y P90 de cada paso</p>
              <table>
                <thead>
                  <tr><th>Estado</th><th>Solicitudes</th><th>Mediana</th><th>P90</th></tr>
                </thead>
                <tbody>
                  {estados.map((e) => (
                    <tr key={e.estado}>
                      <td>{e.estado}</td>
                      <td>{fmtNum(e.solicitudes)}</td>
                      <td>{e.mediana.toFixed(1)}</td>
                      <td>
                        {e.p90.toFixed(1)}
                        <span className="pb" style={{ width: `${(e.p90 / maxP90) * 60}px` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
