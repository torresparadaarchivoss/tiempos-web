import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { periodoPorDefecto } from '../lib/fechas'
import { Cabecera, Kpi, Grafico, PALETA } from '../components/ui'

// Abiertas y posibles errores. Cálculos en la base (funciones abiertas y abiertas_graficos).
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
type Graficos = { por_estado: { estado: string; resultado: string; n: number }[]; dias: { tramo: string; n: number }[] }

const RES = ['EN_PROCESO', 'ESTANCADA', 'SOLO_UN_ESTADO']
const RES_COLOR: Record<string, string> = { EN_PROCESO: PALETA.cielo, ESTANCADA: PALETA.amarillo, SOLO_UN_ESTADO: '#9AA6C4' }
const fmtFecha = (s: string) => (s ? new Date(s).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export default function Abiertas() {
  const { pais, sla } = useOutletContext<{ pais: { id_pais: number; nombre: string }; sla: number }>()
  const navigate = useNavigate()
  const [desde, setDesde] = useState(periodoPorDefecto().desde)
  const [hasta, setHasta] = useState(periodoPorDefecto().hasta)
  const [todo, setTodo] = useState(false)
  const [tipo, setTipo] = useState('')
  const [canal, setCanal] = useState('')
  const [soloErrores, setSoloErrores] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [sel, setSel] = useState<number | null>(null)
  const [dato, setDato] = useState<Dato | null>(null)
  const [graf, setGraf] = useState<Graficos | null>(null)
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
    const args = { p_pais: pais.id_pais, p_desde: desde, p_hasta: hasta, p_tipos: tipo ? [tipo] : null, p_canales: canal ? [canal] : null, p_todo: todo }
    Promise.all([
      sb.rpc('abiertas', { ...args, p_sla: sla }),
      sb.rpc('abiertas_graficos', args),
    ]).then(([r1, r2]) => {
      if (!vivo) return
      if (r1.error) setError('No se pudo calcular: ' + r1.error.message)
      else setDato(r1.data as Dato)
      if (!r2.error) setGraf(r2.data as Graficos)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [pais.id_pais, desde, hasta, todo, tipo, canal, sla])

  if (error) return <p className="error">{error}</p>

  const filas = (dato?.lista ?? [])
    .filter((f) => RES.includes(f.resultado))
    .filter((f) => !soloErrores || f.posible_error)
    .filter((f) => !buscar || [String(f.solicitud), f.estado_actual, f.ultimo_usuario ?? '', f.promotor ?? ''].join(' ').toUpperCase().includes(buscar.toUpperCase()))

  function descargarCsv() {
    const cab = ['Solicitud', 'Resultado', 'Estado actual', 'Alerta', 'Tipo', 'Canal', 'Promotor', 'Creación', 'Último mov.', 'Días sin mov.', 'HH abierta', 'Último usuario', 'Rol']
    const cuerpo = filas.map((f) => [f.solicitud, f.resultado, f.estado_actual, f.alertas, f.tipo, f.canal, f.promotor, f.creacion, f.ultimo_mov, f.dias_sin_mov ?? '', f.hh_abierta ?? '', f.ultimo_usuario ?? '', f.ultimo_rol].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
    const blob = new Blob(['﻿' + [cab.join(';'), ...cuerpo].join('\r\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'abiertas.csv'
    a.click()
  }

  const estadosUnicos = [...new Set(graf?.por_estado.map((e) => e.estado) ?? [])]
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—')

  return (
    <div className="resumen">
      <Cabecera kicker="Abiertas y posibles errores" titulo="Solicitudes que esperan nuestro apoyo" sub="Solicitudes que siguen abiertas: en proceso, estancadas o con un solo estado. Las alertas señalan casos a revisar." pose="prestamito_senalando" />

      <div className="filtros-resumen">
        <label>Desde<input type="date" lang="es-CR" value={desde} disabled={todo} onChange={(e) => setDesde(e.target.value)} /></label>
        <label>Hasta<input type="date" lang="es-CR" value={hasta} disabled={todo} onChange={(e) => setHasta(e.target.value)} /></label>
        <label className="casilla"><input type="checkbox" checked={todo} onChange={(e) => setTodo(e.target.checked)} /> Todo el periodo cargado</label>
        <label>Tipo de solicitud<select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label>Canal<select value={canal} onChange={(e) => setCanal(e.target.value)}><option value="">Todos</option>{canales.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      </div>

      {cargando && <p className="cargando">Calculando abiertas de {pais.nombre}…</p>}

      {!cargando && dato && (
        <>
          <div className="kpis">
            <Kpi label="Abiertas" value={dato.abiertas.toLocaleString('es-CR')} foot={`${pct(dato.abiertas, dato.total_base)} de las creadas`} tono="navy" />
            <Kpi label="En proceso" value={dato.en_proceso.toLocaleString('es-CR')} foot={`${dato.en_proceso_sobre_sla} ya superan el SLA`} tono="cielo" />
            <Kpi label="Estancadas" value={dato.estancadas.toLocaleString('es-CR')} foot="30+ días sin movimiento" tono="naranja" />
            <Kpi label="Un solo estado" value={dato.solo_un_estado.toLocaleString('es-CR')} foot="no se mide su tiempo" tono="lima" />
            <Kpi label="Estado final terminal" value={dato.terminal.toLocaleString('es-CR')} foot="abiertas que parecen cerradas: posible error" tono="rojo" />
          </div>

          <div className="grid-dos">
            <div className="tarjeta-seccion">
              <h2>Abiertas por estado actual</h2>
              <p className="sub">Último estado registrado de cada solicitud abierta</p>
              {graf && graf.por_estado.length > 0 ? (
                <Grafico
                  height={Math.max(300, 26 * estadosUnicos.length + 120)}
                  data={RES.map((r) => ({
                    type: 'bar', orientation: 'h', name: r.replace('_', ' '), marker: { color: RES_COLOR[r] },
                    x: estadosUnicos.map((e) => graf.por_estado.find((x) => x.estado === e && x.resultado === r)?.n ?? 0),
                    y: estadosUnicos,
                  }))}
                  layout={{ barmode: 'stack', margin: { l: 8, r: 16, t: 28, b: 30 } }}
                />
              ) : <p className="sub">Sin datos con estos filtros.</p>}
            </div>
            <div className="tarjeta-seccion">
              <h2>Días sin movimiento</h2>
              <p className="sub">En proceso y estancadas (las de un solo estado no se miden)</p>
              {graf && graf.dias.length > 0 ? (
                <Grafico
                  height={300}
                  data={[{
                    type: 'bar', x: graf.dias.map((d) => d.tramo), y: graf.dias.map((d) => d.n),
                    text: graf.dias.map((d) => d.n.toLocaleString('es-CR')), textposition: 'outside',
                    marker: { color: [PALETA.verde, PALETA.lima, PALETA.amarillo, PALETA.naranja, PALETA.rojo] },
                  }]}
                  layout={{ xaxis: { title: { text: 'Días sin movimiento' } }, yaxis: { title: { text: 'Solicitudes' } }, showlegend: false }}
                />
              ) : <p className="sub">Sin datos de días sin movimiento.</p>}
            </div>
          </div>

          <div className="tarjeta-seccion">
            <h2>Estados finales de las abiertas</h2>
            <p className="sub">Si un estado de esta lista es en realidad un cierre, hay que agregarlo a la clasificación</p>
            <table>
              <thead><tr><th>Estado final</th><th>Solicitudes</th><th>Mediana días sin movimiento</th><th>¿Parece terminal?</th></tr></thead>
              <tbody>{dato.estados_finales.map((e) => (
                <tr key={e.estado_final}><td>{e.estado_final}</td><td>{e.solicitudes}</td><td>{e.dias_mediana ?? '—'}</td><td>{e.parece_terminal ? '✔' : ''}</td></tr>
              ))}</tbody>
            </table>
          </div>

          <div className="tarjeta-seccion">
            <h2>Detalle de solicitudes abiertas</h2>
            <p className="sub">{filas.length.toLocaleString('es-CR')} solicitudes (máximo 500, ordenadas por posible error y días sin movimiento). Selecciona una fila para ver su línea de tiempo.</p>
            <div className="filtros-resumen">
              <label className="casilla"><input type="checkbox" checked={soloErrores} onChange={(e) => setSoloErrores(e.target.checked)} /> Solo posibles errores</label>
              <label>Buscar<input type="text" value={buscar} placeholder="Solicitud, estado, usuario o promotor" onChange={(e) => setBuscar(e.target.value)} /></label>
              <button type="button" className="pestana" disabled={sel == null} onClick={() => navigate('/consulta', { state: { solicitud: sel } })}>Ver línea de tiempo</button>
              <button type="button" className="pestana" onClick={descargarCsv}>Descargar CSV</button>
            </div>
            <div className="tabla-scroll">
              <table>
                <thead><tr>
                  <th></th><th>Solicitud</th><th>Resultado</th><th>Estado actual</th><th>Alerta</th><th>Tipo</th><th>Canal</th>
                  <th>Promotor</th><th>Creación</th><th>Último mov.</th><th>Días sin mov.</th><th>HH abierta</th><th>Último usuario</th><th>Rol</th>
                </tr></thead>
                <tbody>{filas.map((f) => (
                  <tr key={f.solicitud} className={`${f.posible_error ? 'fila-alerta' : ''} ${sel === f.solicitud ? 'fila-sel' : ''}`} onClick={() => setSel(f.solicitud)}>
                    <td><input type="radio" name="sel" checked={sel === f.solicitud} readOnly /></td>
                    <td>{f.solicitud}</td><td>{f.resultado}</td><td>{f.estado_actual}</td><td className="celda-alerta">{f.alertas}</td>
                    <td>{f.tipo}</td><td>{f.canal}</td><td>{f.promotor}</td><td>{fmtFecha(f.creacion)}</td><td>{fmtFecha(f.ultimo_mov)}</td>
                    <td>{f.dias_sin_mov ?? '—'}</td><td>{f.hh_abierta ?? '—'}</td><td>{f.ultimo_usuario ?? '—'}</td><td>{f.ultimo_rol}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div className="preguntas">
            <h2>Preguntas y respuestas</h2>
            <div className="preguntas-grid">
              <div className="qa"><b>¿Cuántas siguen abiertas?</b>{`${dato.abiertas.toLocaleString('es-CR')} solicitudes: ${dato.en_proceso.toLocaleString('es-CR')} en proceso, ${dato.estancadas.toLocaleString('es-CR')} estancadas y ${dato.solo_un_estado.toLocaleString('es-CR')} con un solo estado.`}</div>
              <div className="qa"><b>¿Cuántas podrían ser errores?</b>{`${dato.posibles_errores.toLocaleString('es-CR')} (${pct(dato.posibles_errores, dato.abiertas)} de las abiertas) están estancadas, no avanzaron o terminan en un estado que parece de cierre (${dato.terminal.toLocaleString('es-CR')}).`}</div>
              <div className="qa"><b>¿Dónde se acumulan?</b>{dato.estados_finales[0] ? `El estado actual más frecuente es «${dato.estados_finales[0].estado_final}» con ${dato.estados_finales[0].solicitudes.toLocaleString('es-CR')} solicitudes.` : 'Sin datos.'}</div>
              <div className="qa"><b>¿Cuántas en proceso ya incumplen el SLA?</b>{`${dato.en_proceso_sobre_sla} superan ${sla} HH y ${dato.en_proceso_riesgo} están en riesgo (más del 75% del SLA).`}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
