import { useOutletContext } from 'react-router-dom'

// Contexto compartido por todas las páginas (lo arma Layout).
// El periodo vive en Layout: al cambiarlo en una página se mantiene al navegar a las demás.
export type Periodo = { desde: string; hasta: string }
export type Contexto = {
  pais: { id_pais: number; nombre: string }
  sla: number
  rolesDac: string[]
  resultado: 'EXITOSA' | 'TODOS'
  periodo: Periodo
  setPeriodo: (p: Periodo) => void
}

export const useContexto = () => useOutletContext<Contexto>()

// Mes (primer día) de una fecha aaaa-mm-dd
export const mesDe = (iso: string) => `${iso.slice(0, 7)}-01`

// Último día del mes de una fecha aaaa-mm-dd
export function finDeMes(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
