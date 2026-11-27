import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { Kpi, Grafico, PALETA } from '../components/ui'

// Sección DAC (función equipo_dac y equipo_dac_mes). Solo roles DAC; sin solicitudes de prueba;
// solicitudes con a lo sumo un paso por PENDIENTES.
type Res = { total: number; aprobadas: number; rechazadas: number; rech_recepcion: number; desercion: number; en_proceso: number }
type PersonaLt = { usuario: string; rol: string; estadias: number; solicitudes: number; promedio_hh: number | null; horas: number; promedio_hh_sin_pend: number | null }
type Prod = { usuario: string; rol: string; solicitudes: number; por_dia: number; teorico: number | null; diferencia: number | null; hh_sin_pend: number | null }
type Asesor = { usuario: string; rol: string; solicitudes: number; pendientes: number; pend_por_solicitud: number | null; rech_recepcion: number; rech_recepcion_pct: number | null; rech_analista: number; rech_analista_pct: number | null }
type DacDato = {
  dias_habiles: number
  resultados: Res
  lead_time: { n: number; promedio_creacion_dias: number | null; promedio_asignacion_dias: number | null; promedio_hh_asignacion: number | null }
  persona_lt: PersonaLt[]
  flujo_dia: { dia: number; n: number }[]
  flujo_hora: { hora: number; n: number }[]
  flujo_dia_hora: { dia: number; hora: number; n: number }[]
  pendientes: { grupo: string; orden: number; n: number }[]
  productividad: Prod[]
  asesores: Asesor[]
  capacidad: { hh_promedio_estadia: number | null; max_teorico_dia: number | null; max_observado_dia: number }
}
type Mes = { tiempos: { mes: string; promedio_dias: number | null; n: number }[]; productividad: { mes: string; solicitudes: number; personas: number }[] }

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—')
const nf = (n: number) => n.toLocaleString('es-CR')
// Horas hábiles: menos de 1 HH se muestra en minutos para que se aprecie el dato
const hh = (v: number | null | undefined, decimales = 1) => {
  if (v == null) return '—'
  if (v < 1) return `${Math.round(v * 60)} min`
  return `${v.toFixed(decimales)} HH`
}

// parte: qué subpágina muestra (cada pestaña de Equipo y DAC renderiza una parte)
// Roles asociados al DAC (sin contar analistas, que son el rol DAC). Comercial y SIN CLASIFICAR no entran.
const ASOCIADOS = ['DAC', 'JEFATURA DAC', 'OTRO']

export type Pendientes = 'hasta_uno' | 'todas' | 'sin' | 'una' | 'dos_o_mas'

export default function EquipoDac({ idPais, desde, hasta, parte, soloAnalistas, pend }: { idPais: number; desde: string; hasta: string; parte: 'dac' | 'prod' | 'mes'; soloAnalistas: boolean; pend: Pendientes }) {
  const [dato, setDato] = useState<DacDato | null>(null)
  const [mes, setMes] = useState<Mes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<'mapa' | 'horas'>('mapa')

  useEffect(() => {
    let vivo = true
    sb.rpc('equipo_dac', { p_pais: idPais, p_desde: desde, p_hasta: hasta, p_solo_analistas: soloAnalistas, p_asociados: ASOCIADOS, p_pend: pend }).then(({ data, error: err }) => {
      if (!vivo) return
      if (err) setError('No se pudo calcular el equipo DAC: ' + err.message)
      else {
        // Si la función en la base no trae algún campo (migración sin reaplicar), se usa lista vacía
        const d = data as Partial<DacDato>
        setDato({ ...d, flujo_dia_hora: d.flujo_dia_hora ?? [], flujo_hora: d.flujo_hora ?? [], persona_lt: d.persona_lt ?? [], productividad: d.productividad ?? [], asesores: d.asesores ?? [], pendientes: d.pendientes ?? [] } as DacDato)
      }
    })
    return () => { vivo = false }
  }, [idPais, desde, hasta, soloAnalistas, pend])

  // Series mensuales: no dependen del periodo ni de los filtros de la página
  useEffect(() => {
    let vivo = true
    sb.rpc('equipo_dac_mes', { p_pais: idPais, p_roles_dac: ASOCIADOS }).then(({ data, error: err }) => {
      if (vivo && !err) setMes(data as Mes)
    })
    return () => { vivo = false }
  }, [idPais])

  if (error) return <p className="error">{error}</p>
  if (!dato) return <p className="cargando">Calculando equipo DAC…</p>

  const r = dato.resultados
  const horas = Array.from({ length: 24 }, (_, h) => dato.flujo_hora.find((x) => x.hora === h)?.n ?? 0)

  return (
    <>
      {parte === 'dac' && <>
      <h2 className="seccion">Equipo DAC</h2>
      <p className="sub">Solo roles DAC. Excluye solicitudes de prueba y las que pasaron más de una vez por PENDIENTES.</p>

      <div className="kpis">
        <Kpi label="Aprobadas" value={pct(r.aprobadas, r.total)} foot={`${nf(r.aprobadas)} de ${nf(r.total)}`} tono="verde" />
        <Kpi label="Rechazadas" value={pct(r.rechazadas, r.total)} foot={`Rechazo en recepción: ${pct(r.rech_recepcion, r.total)}`} tono="naranja" />
        <Kpi label="Deserción" value={pct(r.desercion, r.total)} tono="naranja" />
        <Kpi label="En proceso" value={pct(r.en_proceso, r.total)} tono="cielo" />
      </div>

      <div className="kpis">
        <Kpi label="Promedio desde creación hasta resolución" value={dato.lead_time.promedio_creacion_dias?.toFixed(1) ?? '—'} foot="días" tono="navy" />
        <Kpi label="Promedio desde Por Asignar Analista" value={dato.lead_time.promedio_asignacion_dias?.toFixed(1) ?? '—'} foot="días" tono="navy" />
        <Kpi label="Horas hábiles desde Por Asignar Analista" value={hh(dato.lead_time.promedio_hh_asignacion)} foot="promedio por solicitud" tono="cielo" />
      </div>

      <div className="tarjeta-seccion">
        <h2>Lead time por analista y jefatura</h2>
        <p className="sub">Horas hábiles que cada persona tuvo las solicitudes</p>
        <div className="tabla-scroll">
          <table>
            <thead><tr><th>Usuario</th><th>Rol</th><th>Estadías</th><th>Solicitudes</th><th>Promedio HH por estadía</th><th>Horas hábiles</th></tr></thead>
            <tbody>{dato.persona_lt.map((p) => (
              <tr key={p.usuario + p.rol}><td>{p.usuario}</td><td>{p.rol}</td><td>{nf(p.estadias)}</td><td>{nf(p.solicitudes)}</td><td>{hh(p.promedio_hh)}</td><td>{hh(p.horas, 0)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="tarjeta-seccion">
        <h2>Solicitudes por PENDIENTES</h2>
        <p className="sub">Solicitudes que tocó el equipo elegido, según cuántas veces pasaron por PENDIENTES</p>
        <table>
          <thead><tr><th>Grupo</th><th>Solicitudes</th><th>%</th></tr></thead>
          <tbody>{(() => {
            const total = dato.pendientes.reduce((a, g) => a + g.n, 0)
            return dato.pendientes.map((g) => (
              <tr key={g.grupo}><td>{g.grupo}</td><td>{nf(g.n)}</td><td>{pct(g.n, total)}</td></tr>
            ))
          })()}</tbody>
        </table>
      </div>

      <div className="tarjeta-seccion">
        <div className="grupo-roles">
          <button type="button" className={vista === 'mapa' ? 'pestana activa' : 'pestana'} onClick={() => setVista('mapa')}>Solicitudes ingresadas</button>
          <button type="button" className={vista === 'horas' ? 'pestana activa' : 'pestana'} onClick={() => setVista('horas')}>Horas pico</button>
        </div>
        {vista === 'mapa' ? (
          <>
            <h2>Solicitudes ingresadas al DAC por día del mes y hora</h2>
            <p className="sub">Cada celda cuenta las solicitudes que entraron al DAC ese día del mes a esa hora</p>
            <Grafico height={420} data={[{
              type: 'heatmap', x: horas.map((_, h) => `${h}:00`), y: Array.from({ length: 31 }, (_, i) => i + 1),
              z: Array.from({ length: 31 }, (_, d) => Array.from({ length: 24 }, (_, h) => dato.flujo_dia_hora.find((x) => x.dia === d + 1 && x.hora === h)?.n ?? 0)),
              colorscale: [[0, '#F2F4F7'], [1, PALETA.verde]], hovertemplate: 'día %{y}, %{x}: %{z} solicitudes<extra></extra>',
            }]}
              layout={{ showlegend: false, xaxis: { title: { text: 'Hora' } }, yaxis: { title: { text: 'Día del mes' }, dtick: 1, autorange: 'reversed' } }} />
          </>
        ) : (
          <>
            <h2>Horas pico de ingreso</h2>
            <p className="sub">Solicitudes que ingresaron al DAC por hora del día</p>
            <Grafico height={320} data={[{ type: 'bar', x: horas.map((_, h) => `${h}:00`), y: horas, marker: { color: PALETA.cielo } }]}
              layout={{ showlegend: false, yaxis: { title: { text: 'Solicitudes' } } }} />
          </>
        )}
      </div>

      </>}
      {parte === 'prod' && <>
      <div className="tarjeta-seccion">
        <h2>Productividad por analista</h2>
        <p className="sub">Solicitudes distintas por día hábil del periodo ({dato.dias_habiles} días). Teórico = días hábiles × (9 HH ÷ tiempo óptimo), solo analistas DAC</p>
        <div className="tabla-scroll">
          <table>
            <thead><tr><th>Usuario</th><th>Rol</th><th>Solicitudes</th><th>Por día hábil</th><th>Teórico</th><th>Diferencia</th><th>Promedio sin pendientes</th></tr></thead>
            <tbody>{dato.productividad.map((p) => (
              <tr key={p.usuario + p.rol}><td>{p.usuario}</td><td>{p.rol}</td><td>{nf(p.solicitudes)}</td><td>{p.por_dia.toFixed(2)}</td>
                <td>{p.teorico == null ? '—' : nf(p.teorico)}</td>
                <td>{p.diferencia == null ? '—' : `${p.diferencia > 0 ? '+' : ''}${nf(p.diferencia)}`}</td>
                <td>{hh(p.hh_sin_pend, 2)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <p className="sub">Promedio sin pendientes: horas hábiles por estadía en todos los estados, excepto PENDIENTE.</p>
      </div>

      <div className="tarjeta-seccion">
        <h2>Asesores: pendientes y rechazos</h2>
        <p className="sub">Quién mueve la solicitud. Pendientes generados = veces que la envió a PENDIENTE. Rechazos por solicitud, en recepción y por analista</p>
        <div className="tabla-scroll">
          <table>
            <thead><tr><th>Usuario</th><th>Rol</th><th>Solicitudes</th><th>Pendientes generados</th><th>Pendientes por solicitud</th><th>Rechazo recepción</th><th>Rechazo analista</th></tr></thead>
            <tbody>{dato.asesores.map((a) => (
              <tr key={a.usuario + a.rol}><td>{a.usuario}</td><td>{a.rol}</td><td>{nf(a.solicitudes)}</td><td>{nf(a.pendientes)}</td>
                <td>{a.pend_por_solicitud == null ? '—' : a.pend_por_solicitud.toFixed(2)}</td>
                <td>{nf(a.rech_recepcion)} ({pct(a.rech_recepcion, a.solicitudes)})</td>
                <td>{nf(a.rech_analista)} ({pct(a.rech_analista, a.solicitudes)})</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="tarjeta-seccion">
        <h2>Capacidad por analista</h2>
        <div className="kpis">
          <Kpi label="Tiempo promedio por estadía" value={hh(dato.capacidad.hh_promedio_estadia, 2)} foot="promedio de horas hábiles por estadía DAC" tono="verde" />
          <Kpi label="Máximo teórico por día" value={dato.capacidad.max_teorico_dia?.toFixed(1) ?? '—'} foot="solicitudes: 9 HH ÷ tiempo óptimo" tono="navy" />
          <Kpi label="Máximo observado en un día" value={dato.capacidad.max_observado_dia} foot="solicitudes distintas, un analista, un día" tono="naranja" />
        </div>
      </div>

      </>}
      {parte === 'mes' && mes && (
        <div className="grid-dos">
          <div className="tarjeta-seccion">
            <h2>Tiempo de respuesta por mes</h2>
            <p className="sub">Promedio de días de creación a resolución. Año en curso, sin filtros de periodo, tipo ni canal</p>
            <Grafico height={300} data={[{ type: 'scatter', mode: 'lines+markers', x: mes.tiempos.map((t) => t.mes), y: mes.tiempos.map((t) => t.promedio_dias), line: { color: PALETA.verde } }]}
              layout={{ showlegend: false, yaxis: { title: { text: 'Días' } } }} />
          </div>
          <div className="tarjeta-seccion">
            <h2>Productividad por mes</h2>
            <p className="sub">Solicitudes distintas que tocó el DAC cada mes. Año en curso, sin filtros</p>
            <Grafico height={300} data={[{ type: 'bar', x: mes.productividad.map((t) => t.mes), y: mes.productividad.map((t) => t.solicitudes), marker: { color: PALETA.navy } }]}
              layout={{ showlegend: false, yaxis: { title: { text: 'Solicitudes' } } }} />
          </div>
        </div>
      )}
    </>
  )
}
