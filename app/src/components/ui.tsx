import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'
import type { ReactNode } from 'react'

// Componentes compartidos con la identidad Instacredit (skill marca-instacredit):
// cabecera con Prestamito, tarjetas KPI con franja de color y gráficos con la paleta de marca.
const Plot = createPlotlyComponent(Plotly)
const BASE = `${import.meta.env.BASE_URL}brand/`

export const PALETA = {
  verde: '#4B9D45', navy: '#06255B', naranja: '#F5821F', cielo: '#00A4E0',
  lima: '#93BF02', amarillo: '#F2C20C', rojo: '#EE232E', gris: '#5B6170',
}
export const SECUENCIA = [PALETA.verde, PALETA.navy, PALETA.naranja, PALETA.cielo, PALETA.lima, PALETA.amarillo]

export function Grafico({ data, layout, height = 320 }: { data: unknown[]; layout?: Record<string, unknown>; height?: number }) {
  const base = {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Arial, Helvetica, sans-serif', color: '#333740', size: 12 },
    margin: { l: 44, r: 16, t: 28, b: 40 }, colorway: SECUENCIA,
    legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, x: 0, title: { text: '' } },
    hoverlabel: { bgcolor: PALETA.navy, font: { color: '#fff' } },
    xaxis: { gridcolor: '#E6E9EF', linecolor: '#D9DDE4' },
    yaxis: { gridcolor: '#E6E9EF', linecolor: '#D9DDE4' },
  }
  return (
    <Plot
      data={data as never}
      layout={{ ...base, ...layout, height } as never}
      config={{ displaylogo: false, responsive: true }}
      style={{ width: '100%' }}
      useResizeHandler
    />
  )
}

// Cabecera de página: kicker, titular, subtítulo y Prestamito según el mensaje de la página
export function Cabecera({ kicker, titulo, sub, pose }: { kicker: string; titulo: string; sub?: string; pose: string }) {
  return (
    <div className="banner">
      <div className="banner-texto">
        <span className="kicker">{kicker}</span>
        <h2>{titulo}</h2>
        {sub && <p>{sub}</p>}
      </div>
      <img className="banner-pm" src={`${BASE}${pose}.png`} alt="Prestamito" />
    </div>
  )
}

// Tarjeta KPI con franja superior de color y mini gráfico opcional
export function Kpi({
  label, value, foot, tono = 'verde', spark, relleno = false,
}: { label: string; value: ReactNode; foot?: ReactNode; tono?: 'verde' | 'navy' | 'naranja' | 'cielo' | 'lima' | 'rojo'; spark?: number[]; relleno?: boolean }) {
  const color = PALETA[tono === 'verde' ? 'verde' : tono === 'navy' ? 'navy' : tono === 'naranja' ? 'naranja' : tono === 'cielo' ? 'cielo' : tono === 'lima' ? 'lima' : 'rojo']
  const fg = tono === 'lima' ? PALETA.navy : '#fff'
  return (
    <div className={relleno ? 'kpi kpi-relleno' : 'kpi'} style={{ borderTopColor: color, background: relleno ? color : undefined, color: relleno ? fg : undefined }}>
      <span style={{ color: relleno ? fg : undefined }}>{label}</span>
      <strong style={{ color: relleno ? fg : undefined }}>{value}</strong>
      {foot && <small style={{ color: relleno ? fg : undefined }}>{foot}</small>}
      {spark && spark.length > 1 && <Mini valores={spark} color={relleno ? fg : color} />}
    </div>
  )
}

function Mini({ valores, color }: { valores: number[]; color: string }) {
  const v = valores.filter((x) => Number.isFinite(x))
  if (v.length < 2) return null
  const lo = Math.min(...v), hi = Math.max(...v), w = 180, h = 34
  const pts = v.map((x, i) => `${(i * w) / (v.length - 1)},${h - 2 - ((x - lo) / (hi - lo || 1)) * (h - 4)}`).join(' ')
  return (
    <svg className="mini" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" points={pts} />
    </svg>
  )
}
