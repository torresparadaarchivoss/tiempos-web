// Fechas en hora LOCAL (no UTC): evita que "hasta" caiga en el día siguiente después de las 6 p.m. en Costa Rica.
export function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

// Formato en español para mostrar: 10/08/2026
export function fechaEs(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Periodo por defecto: últimos 3 meses hasta hoy (hora local)
export function periodoPorDefecto(): { desde: string; hasta: string } {
  const hoy = new Date()
  const hace3 = new Date(hoy)
  hace3.setMonth(hoy.getMonth() - 3)
  return { desde: ymd(hace3), hasta: ymd(hoy) }
}
