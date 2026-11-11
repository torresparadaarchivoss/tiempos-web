import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'

type Sol = {
  solicitud: number; resultado: string; estado_final: string; tipo: string; promotor: string; sucursal: string
  leadtime_formalizado: number | null; hh_analisis: number | null; solo_un_estado: boolean; movs_dac: number; tocada_dac: boolean
}
type Mov = {
  orden: number; estado: string; fecha_hora: string; fecha_fin: string | null; hh: number | null
  horas_estado: number | null; usuario: string | null; rol: string; fuera_analisis: boolean
}
type Dato = {
  recientes: { solicitud: number; resultado: string; estado_actual: string; tipo: string; creacion: string }[]
  solicitud: Sol | null
  movimientos: Mov[]
}

const fmtFecha = (s: string | null) => (s ? new Date(s).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const fmtH = (h: number | null) => (h == null ? '—' : `${h.toFixed(1)} HH`)

export default function Consulta() {
  const { pais } = useOutletContext<{ pais: { id_pais: number; nombre: string } }>()
  const [texto, setTexto] = useState('')
  const [numero, setNumero] = useState<number | null>(null)
  const [dato, setDato] = useState<Dato | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.rpc('consulta', { p_pais: pais.id_pais, p_solicitud: numero }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo consultar: ' + err.message)
      else setDato(data as Dato)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, numero])

  function buscar() {
    const n = Number(texto.trim())
    setNumero(Number.isFinite(n) && n > 0 ? n : null)
  }

  if (error) return <p className="error">{error}</p>

  const s = dato?.solicitud
  return (
    <div className="resumen">
      <div className="filtros-resumen">
        <label>
          Número de solicitud
          <input
            type="text"
            inputMode="numeric"
            value={texto}
            placeholder="Escribí el número y pulsá Enter"
            onChange={(e) => setTexto(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && buscar()}
          />
        </label>
        <button type="button" className="pestana activa" onClick={buscar}>Buscar</button>
        {numero && <button type="button" className="pestana" onClick={() => { setTexto(''); setNumero(null) }}>Volver a recientes</button>}
      </div>

      {cargando && <p className="cargando">Buscando en {pais.nombre}…</p>}

      {!cargando && dato && numero == null && (
        <div className="tarjeta-seccion">
          <h2>Solicitudes recientes</h2>
          <table>
            <thead><tr><th>Solicitud</th><th>Resultado</th><th>Estado actual</th><th>Tipo</th><th>Creación</th></tr></thead>
            <tbody>{dato.recientes.map((r) => (
              <tr key={r.solicitud} className="fila-enlace" onClick={() => { setTexto(String(r.solicitud)); setNumero(r.solicitud) }}>
                <td>{r.solicitud}</td><td>{r.resultado}</td><td>{r.estado_actual}</td><td>{r.tipo}</td><td>{fmtFecha(r.creacion)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {!cargando && dato && numero != null && !s && (
        <div className="vacio">
          <h2>No encontramos esa solicitud</h2>
          <p>Revisá el número o revisa que pertenezca a {pais.nombre}.</p>
        </div>
      )}

      {!cargando && s && (
        <>
          <div className="kpis">
            <div className="kpi"><span>Resultado</span><strong className="kpi-texto">{s.resultado.replace('_', ' ')}</strong><small>{s.tipo} · {s.promotor ?? ''}</small></div>
            <div className="kpi"><span>A formalización</span><strong>{fmtH(s.leadtime_formalizado)}</strong><small>horas hábiles hasta aprobado informa</small></div>
            <div className="kpi"><span>Horas hábiles en el análisis</span><strong>{s.solo_un_estado ? '—' : fmtH(s.hh_analisis)}</strong><small>{s.solo_un_estado ? 'un solo estado: no se mide' : ''}</small></div>
            <div className="kpi"><span>Tocada por DAC</span><strong>{s.tocada_dac ? 'Sí' : 'No'}</strong><small>{s.movs_dac} movimientos</small></div>
          </div>

          <div className="tarjeta-seccion">
            <h2>Solicitud {s.solicitud}</h2>
            <p className="sub">Estado final: {s.estado_final} · Sucursal: {s.sucursal ?? '—'}</p>
            <table>
              <thead><tr><th>#</th><th>Estado</th><th>Entrada</th><th>Salida</th><th>HH</th><th>Horas calendario</th><th>Usuario</th><th>Rol</th><th>Fuera de análisis</th></tr></thead>
              <tbody>{dato.movimientos.map((m) => (
                <tr key={m.orden} className={m.fuera_analisis ? 'fila-fuera' : ''}>
                  <td>{m.orden}</td><td>{m.estado}</td><td>{fmtFecha(m.fecha_hora)}</td><td>{fmtFecha(m.fecha_fin)}</td>
                  <td>{m.hh == null ? '—' : m.hh.toFixed(2)}</td><td>{m.horas_estado == null ? '—' : m.horas_estado.toFixed(1)}</td>
                  <td>{m.usuario ?? '—'}</td><td>{m.rol}</td><td>{m.fuera_analisis ? 'Sí' : 'No'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
