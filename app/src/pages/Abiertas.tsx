import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { Cabecera } from '../components/ui'


type Fila = {
  solicitud: number; resultado: string; estado_actual: string; alertas: string; tipo: string; canal: string
  promotor: string; creacion: string; ultimo_mov: string; dias_sin_mov: number | null; hh_abierta: number | null
  ultimo_usuario: string | null; ultimo_rol: string; posible_error: boolean
}
type Dato = {
  total_base: number; abiertas: number; en_proceso: number; estancadas: number; solo_un_estado: number
  terminal: number; en_proceso_sobre_sla: number; en_proceso_riesgo: number; posibles_errores: number; sla: number
  estados_finales: { estado_final: string; solicitudes: number; dias_mediana: number | null; parece_terminal: boolean }[]
  lista: Fila[]
}

const RES = ['EN_PROCESO', 'ESTANCADA', 'SOLO_UN_ESTADO']
const fmtFecha = (s: string) => (s ? new Date(s).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export default function Abiertas() {
  const { pais, sla } = useOutletContext<{ pais: { id_pais: number; nombre: string }; sla: number }>()
  const hoy = new Date()
  const hace3 = new Date(hoy)
  hace3.setMonth(hoy.getMonth() - 3)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const [desde, setDesde] = useState(iso(hace3))
  const [hasta, setHasta] = useState(iso(hoy))
  const [todo, setTodo] = useState(false)
  const [tipo, setTipo] = useState('')
  const [soloErrores, setSoloErrores] = useState(false)
  const [buscar, setBuscar] = useState('')
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
    return () => { vivo = false }
  }, [pais.id_pais])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.rpc('abiertas', {
      p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta,
      p_tipos: tipo ? [tipo] : null, p_canales: null, p_todo: todo, p_sla: sla,
    }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo calcular: ' + err.message)
      else setDato(data as Dato)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, desde, hasta, todo, tipo, sla])

  if (error) return <p className="error">{error}</p>

  const filas = (dato?.lista ?? [])
    .filter((f) => RES.includes(f.resultado))
    .filter((f) => !soloErrores || f.posible_error)
    .filter((f) => !buscar || [String(f.solicitud), f.estado_actual, f.ultimo_usuario ?? '', f.promotor ?? '']
      .join(' ').toUpperCase().includes(buscar.toUpperCase()))

  return (
    <div className="resumen">
      <Cabecera kicker="Abiertas y posibles errores" titulo="Solicitudes que esperan nuestro apoyo" sub="Solicitudes que siguen abiertas y las alertas a revisar." pose="prestamito_senalando" />
      <div className="filtros-resumen">
        <label>Desde<input type="date" value={desde} disabled={todo} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" value={hasta} disabled={todo} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="casilla">
          <input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> Todo el periodo cargado
        </label>
        <label>
          Tipo de solicitud
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      {cargando && <p className="cargando">Calculando abiertas de {pais.nombre}…</p>}

      {!cargando && dato && (
        <>
          <div className="kpis">
            <div className="kpi"><span>Abiertas</span><strong>{dato.abiertas.toLocaleString('es-CR')}</strong><small>{dato.total_base ? `${((dato.abiertas / dato.total_base) * 100).toFixed(1)}% de las creadas` : ''}</small></div>
            <div className="kpi"><span>En proceso</span><strong>{dato.en_proceso.toLocaleString('es-CR')}</strong><small>{dato.en_proceso_sobre_sla} ya superan el SLA</small></div>
            <div className="kpi"><span>Estancadas</span><strong>{dato.estancadas.toLocaleString('es-CR')}</strong><small>30+ días sin movimiento</small></div>
            <div className="kpi"><span>Un solo estado</span><strong>{dato.solo_un_estado.toLocaleString('es-CR')}</strong><small>no se mide su tiempo</small></div>
            <div className="kpi"><span>Estado final terminal</span><strong>{dato.terminal.toLocaleString('es-CR')}</strong><small>abiertas que parecen cerradas: posible error</small></div>
          </div>

          <div className="tarjeta-seccion">
            <h2>Estados finales de las abiertas</h2>
            <p className="sub">Si un estado de esta lista es en realidad un cierre, hay que agregarlo a la clasificación</p>
            <table>
              <thead><tr><th>Estado final</th><th>Solicitudes</th><th>Mediana días sin movimiento</th><th>¿Parece terminal?</th></tr></thead>
              <tbody>{dato.estados_finales.map((e) => (
                <tr key={e.estado_final}>
                  <td>{e.estado_final}</td><td>{e.solicitudes}</td><td>{e.dias_mediana ?? '—'}</td>
                  <td>{e.parece_terminal ? '✔' : ''}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <div className="tarjeta-seccion">
            <h2>Detalle de solicitudes abiertas</h2>
            <p className="sub">{filas.length.toLocaleString('es-CR')} solicitudes (máximo 500 en pantalla, ordenadas por posible error y días sin movimiento)</p>
            <div className="filtros-resumen">
              <label className="casilla"><input type="checkbox" checked={soloErrores} onChange={(e) => setSoloErrores(e.target.checked)} /> Solo posibles errores</label>
              <label>Buscar<input type="text" value={buscar} placeholder="Solicitud, estado, usuario o promotor" onChange={(e) => setBuscar(e.target.value)} /></label>
            </div>
            <div className="tabla-scroll">
              <table>
                <thead><tr>
                  <th>Solicitud</th><th>Resultado</th><th>Estado actual</th><th>Alerta</th><th>Tipo</th><th>Canal</th>
                  <th>Promotor</th><th>Creación</th><th>Último mov.</th><th>Días sin mov.</th><th>HH abierta</th><th>Último usuario</th><th>Rol</th>
                </tr></thead>
                <tbody>{filas.map((f) => (
                  <tr key={f.solicitud} className={f.posible_error ? 'fila-alerta' : ''}>
                    <td>{f.solicitud}</td><td>{f.resultado}</td><td>{f.estado_actual}</td><td className="celda-alerta">{f.alertas}</td>
                    <td>{f.tipo}</td><td>{f.canal}</td><td>{f.promotor}</td><td>{fmtFecha(f.creacion)}</td><td>{fmtFecha(f.ultimo_mov)}</td>
                    <td>{f.dias_sin_mov ?? '—'}</td><td>{f.hh_abierta ?? '—'}</td><td>{f.ultimo_usuario ?? '—'}</td><td>{f.ultimo_rol}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
