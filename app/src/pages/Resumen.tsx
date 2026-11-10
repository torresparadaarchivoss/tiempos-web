import { useEffect, useMemo, useState } from 'react'
import { sb } from '../lib/supabase'

// Fila agregada de public.resumen_mensual (solo cifras, sin personas ni solicitudes)
type Fila = {
  mes: string
  tipo_solicitud: string
  resultado_final: string
  creadas: number
  formalizadas: number
  suma_hh_formalizado: number
  dentro_sla: number
  hasta_8_hh: number
  de_8_a_16_hh: number
  de_16_a_24_hh: number
  mas_de_24_hh: number
}

type Pais = { id_pais: number; nombre: string }

const SLA_HH = 24
const TODOS = '__todos__'

const fmtNum = (n: number) => n.toLocaleString('es-CR')
const fmtPct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—')
const fmtHH = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} HH` : '—')
const etiquetaMes = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('es-CR', { month: 'short', year: 'numeric' })

export default function Resumen({ pais }: { pais: Pais }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tipo, setTipo] = useState(TODOS)
  const [desde, setDesde] = useState<string>('')
  const [hasta, setHasta] = useState<string>('')

  // Carga las cifras del país elegido. RLS ya restringe a los países del usuario.
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
    return () => {
      vivo = false
    }
  }, [pais.id_pais])

  const meses = useMemo(() => [...new Set(filas.map((f) => f.mes))].sort(), [filas])
  const tipos = useMemo(() => [...new Set(filas.map((f) => f.tipo_solicitud))].sort(), [filas])

  // Periodo por defecto: todo el rango disponible
  const mesDesde = desde || meses[0] || ''
  const mesHasta = hasta || meses[meses.length - 1] || ''

  const filtradas = useMemo(
    () =>
      filas.filter(
        (f) =>
          f.mes >= mesDesde &&
          f.mes <= mesHasta &&
          (tipo === TODOS || f.tipo_solicitud === tipo),
      ),
    [filas, mesDesde, mesHasta, tipo],
  )

  // KPIs: la conversión usa todas las creadas; los tiempos solo las formalizadas
  const k = useMemo(() => {
    const suma = (fn: (f: Fila) => number) => filtradas.reduce((acc, f) => acc + fn(f), 0)
    const creadas = suma((f) => f.creadas)
    const formalizadas = suma((f) => f.formalizadas)
    const sumaHH = suma((f) => f.suma_hh_formalizado)
    const dentro = suma((f) => f.dentro_sla)
    return {
      creadas,
      formalizadas,
      conversion: formalizadas / creadas,
      promedioHH: sumaHH / formalizadas,
      dentroSLA: dentro / formalizadas,
      rangos: [
        { etiqueta: `≤ 8 HH`, n: suma((f) => f.hasta_8_hh) },
        { etiqueta: `8–16 HH`, n: suma((f) => f.de_8_a_16_hh) },
        { etiqueta: `16–24 HH`, n: suma((f) => f.de_16_a_24_hh) },
        { etiqueta: `> 24 HH`, n: suma((f) => f.mas_de_24_hh) },
      ],
    }
  }, [filtradas])

  // Serie mensual para la tabla
  const porMes = useMemo(() => {
    const m = new Map<string, { creadas: number; formalizadas: number; sumaHH: number; dentro: number }>()
    for (const f of filtradas) {
      const x = m.get(f.mes) ?? { creadas: 0, formalizadas: 0, sumaHH: 0, dentro: 0 }
      x.creadas += f.creadas
      x.formalizadas += f.formalizadas
      x.sumaHH += f.suma_hh_formalizado
      x.dentro += f.dentro_sla
      m.set(f.mes, x)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtradas])

  if (cargando) return <p className="cargando">Cargando cifras de {pais.nombre}…</p>
  if (error) return <p className="error">{error}</p>
  if (filas.length === 0) {
    return (
      <div className="vacio">
        <h2>Sin cifras para {pais.nombre}</h2>
        <p>Todavía no hay datos cargados para este país.</p>
      </div>
    )
  }

  const maxRango = Math.max(...k.rangos.map((r) => r.n), 1)

  return (
    <div className="resumen">
      <div className="filtros-resumen">
        <label>
          Desde
          <select value={mesDesde} onChange={(e) => setDesde(e.target.value)}>
            {meses.map((m) => (
              <option key={m} value={m}>{etiquetaMes(m)}</option>
            ))}
          </select>
        </label>
        <label>
          Hasta
          <select value={mesHasta} onChange={(e) => setHasta(e.target.value)}>
            {meses.map((m) => (
              <option key={m} value={m}>{etiquetaMes(m)}</option>
            ))}
          </select>
        </label>
        <label>
          Tipo de solicitud
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value={TODOS}>Todos</option>
            {tipos.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Solicitudes creadas</span><strong>{fmtNum(k.creadas)}</strong></div>
        <div className="kpi"><span>Formalizadas</span><strong>{fmtNum(k.formalizadas)}</strong></div>
        <div className="kpi"><span>Conversión</span><strong>{fmtPct(k.conversion)}</strong></div>
        <div className="kpi"><span>Promedio HH a formalizar</span><strong>{fmtHH(k.promedioHH)}</strong></div>
        <div className="kpi"><span>Dentro del SLA ({SLA_HH} HH)</span><strong>{fmtPct(k.dentroSLA)}</strong></div>
      </div>

      <div className="grid-dos">
        <div className="tarjeta-seccion">
          <h2>Horas hábiles a formalizar</h2>
          {k.rangos.map((r) => (
            <div key={r.etiqueta} className="barra-fila">
              <span className="barra-etiqueta">{r.etiqueta}</span>
              <div className="barra-pista">
                <div className="barra-valor" style={{ width: `${(r.n / maxRango) * 100}%` }} />
              </div>
              <span className="barra-numero">{fmtNum(r.n)}</span>
            </div>
          ))}
        </div>

        <div className="tarjeta-seccion">
          <h2>Por mes</h2>
          <table>
            <thead>
              <tr><th>Mes</th><th>Creadas</th><th>Formalizadas</th><th>Promedio HH</th><th>% SLA</th></tr>
            </thead>
            <tbody>
              {porMes.map(([mes, x]) => (
                <tr key={mes}>
                  <td>{etiquetaMes(mes)}</td>
                  <td>{fmtNum(x.creadas)}</td>
                  <td>{fmtNum(x.formalizadas)}</td>
                  <td>{fmtHH(x.sumaHH / x.formalizadas)}</td>
                  <td>{fmtPct(x.dentro / x.formalizadas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
