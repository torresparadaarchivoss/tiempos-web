import { useEffect, useState } from 'react'
import { sb } from '../lib/supabase'
import { Grafico, PALETA } from './ui'

// "Lead time promedio por mes": total y por tipo, con línea de SLA.
// Mismas reglas que el tablero: PERSONAL se suma a NO ASALARIADO; solo meses con 5+ formalizadas.
const MIN_N = 5
const TIPOS = ['ASALARIADO', 'NO ASALARIADO', 'PYMES']
const COLOR = { ASALARIADO: PALETA.verde, 'NO ASALARIADO': PALETA.naranja, PYMES: PALETA.cielo, Total: PALETA.navy }

type Fila = { mes: string; tipo_solicitud: string; formalizadas: number; suma_hh_formalizado: number }

export default function LeadTimeMes({ idPais, sla }: { idPais: number; sla: number }) {
  const [filas, setFilas] = useState<Fila[]>([])
  useEffect(() => {
    let vivo = true
    sb.from('resumen_mensual')
      .select('mes, tipo_solicitud, formalizadas, suma_hh_formalizado')
      .eq('id_pais', idPais)
      .then(({ data }) => { if (vivo && data) setFilas(data as Fila[]) })
    return () => { vivo = false }
  }, [idPais])

  // Agrupa por mes y por tipo (PERSONAL -> NO ASALARIADO)
  const porMesTipo = new Map<string, { n: number; s: number }>()
  const porMes = new Map<string, { n: number; s: number }>()
  for (const f of filas) {
    const tipo = f.tipo_solicitud === 'PERSONAL' ? 'NO ASALARIADO' : f.tipo_solicitud
    const kT = `${f.mes}|${tipo}`
    const a = porMesTipo.get(kT) ?? { n: 0, s: 0 }
    a.n += f.formalizadas; a.s += Number(f.suma_hh_formalizado)
    porMesTipo.set(kT, a)
    const b = porMes.get(f.mes) ?? { n: 0, s: 0 }
    b.n += f.formalizadas; b.s += Number(f.suma_hh_formalizado)
    porMes.set(f.mes, b)
  }

  const trazas: Record<string, { x: string[]; y: number[] }> = { Total: { x: [], y: [] } }
  for (const t of TIPOS) trazas[t] = { x: [], y: [] }
  for (const [mes, v] of [...porMes.entries()].sort()) {
    if (v.n >= MIN_N) { trazas.Total.x.push(mes); trazas.Total.y.push(v.s / v.n) }
  }
  for (const [k, v] of [...porMesTipo.entries()].sort()) {
    const [mes, tipo] = k.split('|')
    if (TIPOS.includes(tipo) && v.n >= MIN_N) { trazas[tipo].x.push(mes); trazas[tipo].y.push(v.s / v.n) }
  }

  const data = Object.entries(trazas).filter(([, t]) => t.x.length).map(([nombre, t]) => ({
    type: 'scatter', mode: 'lines+markers', name: nombre === 'Total' ? 'Total' : nombre,
    x: t.x, y: t.y,
    line: { color: COLOR[nombre as keyof typeof COLOR], width: nombre === 'Total' ? 4 : 2.4 },
    marker: { size: nombre === 'Total' ? 9 : 7, color: COLOR[nombre as keyof typeof COLOR] },
    hovertemplate: '<b>%{fullData.name}</b><br>%{x|%b %Y}: %{y:.1f} HH<extra></extra>',
  }))

  return (
    <div className="tarjeta-seccion">
      <h2>Lead time promedio por mes</h2>
      <p className="sub">Horas hábiles promedio a formalización por mes de creación: total y por tipo (meses con {MIN_N}+ formalizadas; PERSONAL se incluye en NO ASALARIADO)</p>
      {data.length === 0 ? <p className="sub">Faltan meses con datos suficientes.</p> : (
        <Grafico
          data={data}
          height={340}
          layout={{
            yaxis: { title: { text: 'HH promedio' } },
            xaxis: { dtick: 'M1', tickformat: '%b %Y' },
            shapes: [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: sla, y1: sla, line: { color: PALETA.gris, dash: 'dash', width: 2 } }],
            annotations: [{ xref: 'paper', x: 1, y: sla, text: `SLA ${sla}`, showarrow: false, xanchor: 'right', yanchor: 'bottom' }],
          }}
        />
      )}
    </div>
  )
}
