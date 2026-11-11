import { useEffect, useState } from 'react'
import { useLocation, useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'

// Consulta por solicitud: línea de tiempo de estados y detalle de movimientos (función consulta).
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

const FASE_COLOR: Record<string, string> = {
  EXITOSA: PALETA.verde, RECHAZADA: PALETA.rojo, DESERCION: PALETA.naranja, ABIERTA: PALETA.cielo, 'Fuera de análisis': '#A0AEC0',
}
const fmtFecha = (s: string | null) => (s ? new Date(s).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const fmtH = (h: number | null) => (h == null ? '—' : `${h.toFixed(1)} HH`)

export default function Consulta() {
  const { pais, rolesDac } = useOutletContext<{ pais: { id_pais: number; nombre: string }; rolesDac: string[] }>()
  const location = useLocation()
  const desdeAbiertas = (location.state as { solicitud?: number } | null)?.solicitud
  const [texto, setTexto] = useState(desdeAbiertas ? String(desdeAbiertas) : '')
  const [numero, setNumero] = useState<number | null>(desdeAbiertas ?? null)
  const [dato, setDato] = useState<Dato | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError(null)
    sb.rpc('consulta', { p_pais: pais.id_pais, p_solicitud: numero, p_roles_dac: rolesDac }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo consultar: ' + err.message)
      else setDato(data as Dato)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, numero, rolesDac])

  function buscar() {
    const n = Number(texto.trim())
    setNumero(Number.isFinite(n) && n > 0 ? n : null)
  }

  if (error) return <p className="error">{error}</p>

  const s = dato?.solicitud
  const movs = dato?.movimientos ?? []

  return (
    <div className="resumen">
      <Cabecera kicker="Consulta por solicitud" titulo="La historia completa de cada solicitud" sub="Línea de tiempo de una solicitud. Los estados posteriores a aprobado informa se muestran en gris: quedan fuera del tiempo a formalizar." pose="prestamito_leyendo" />

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
        {numero != null && <button type="button" className="pestana" onClick={() => { setTexto(''); setNumero(null) }}>Volver a recientes</button>}
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
        <div className="vacio"><h2>No encontramos esa solicitud</h2><p>Revisá el número o revisa que pertenezca a {pais.nombre}.</p></div>
      )}

      {!cargando && s && (
        <>
          <div className="kpis">
            <Kpi label="Resultado" value={s.resultado.replace('_', ' ')} foot={`${s.tipo} · ${s.promotor ?? ''}`} tono="verde" />
            <Kpi label="A formalización" value={fmtH(s.leadtime_formalizado)} foot="horas hábiles hasta aprobado informa" tono="cielo" />
            <Kpi label="Horas hábiles en el análisis" value={s.solo_un_estado ? '—' : fmtH(s.hh_analisis)} foot={s.solo_un_estado ? 'un solo estado: no se mide' : ''} tono="navy" />
            <Kpi label="Tocada por DAC" value={s.tocada_dac ? 'Sí' : 'No'} foot={`${s.movs_dac} movimientos`} tono="naranja" />
          </div>

          <div className="tarjeta-seccion">
            <h2>Estados en el tiempo</h2>
            <p className="sub">Solicitud {s.solicitud} · estado final {s.estado_final}</p>
            {movs.length > 0 && (
              <Grafico
                height={Math.max(280, 40 * movs.length + 100)}
                data={[{
                  type: 'bar', orientation: 'h',
                  y: movs.map((m) => m.estado), x: movs.map((m) => (new Date(m.fecha_fin ?? m.fecha_hora).getTime() - new Date(m.fecha_hora).getTime())),
                  base: movs.map((m) => m.fecha_hora),
                  marker: { color: movs.map((m) => (m.fuera_analisis ? '#A0AEC0' : FASE_COLOR[s.resultado] ?? PALETA.cielo)) },
                  customdata: movs.map((m) => [fmtFecha(m.fecha_hora), fmtFecha(m.fecha_fin), m.usuario ?? '—']),
                  hovertemplate: '<b>%{y}</b><br>%{customdata[0]} → %{customdata[1]}<br>%{customdata[2]}<extra></extra>',
                }]}
                layout={{ xaxis: { type: 'date', title: { text: '' } }, yaxis: { autorange: 'reversed', automargin: true }, showlegend: false, margin: { l: 8, r: 16, t: 16, b: 30 } }}
              />
            )}
          </div>

          <div className="tarjeta-seccion">
            <h2>Detalle de movimientos</h2>
            <div className="tabla-scroll">
              <table>
                <thead><tr><th>#</th><th>Estado</th><th>Entrada</th><th>Salida</th><th>HH</th><th>Horas calendario</th><th>Usuario</th><th>Rol</th><th>Fuera de análisis</th></tr></thead>
                <tbody>{movs.map((m) => (
                  <tr key={m.orden} className={m.fuera_analisis ? 'fila-fuera' : ''}>
                    <td>{m.orden}</td><td>{m.estado}</td><td>{fmtFecha(m.fecha_hora)}</td><td>{fmtFecha(m.fecha_fin)}</td>
                    <td>{m.hh == null ? '—' : m.hh.toFixed(2)}</td><td>{m.horas_estado == null ? '—' : m.horas_estado.toFixed(1)}</td>
                    <td>{m.usuario ?? '—'}</td><td>{m.rol}</td><td>{m.fuera_analisis ? 'Sí' : 'No'}</td>
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
