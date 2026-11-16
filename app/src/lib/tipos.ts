// PERSONAL se une a NO ASALARIADO en todo el sitio (igual que en el gráfico de Lead Time).
export const unificarTipo = (t: string) => (t === 'PERSONAL' ? 'NO ASALARIADO' : t)

// Lista de tipos para los filtros, ya unificada y sin repetidos
export const listaTipos = (tipos: string[]) => [...new Set(tipos.map(unificarTipo))].sort()

// Nombre visible de cada resultado: SOLO_UN_ESTADO se muestra como ABANDONO (en la base sigue igual)
export const etiquetaResultado = (r: string) => (r === 'SOLO_UN_ESTADO' ? 'ABANDONO' : r.replace(/_/g, ' '))

// Tipos a enviar a las funciones de la base: NO ASALARIADO incluye PERSONAL por si quedan datos sin unificar
export const tiposConsulta = (tipo: string): string[] | null =>
  !tipo ? null : tipo === 'NO ASALARIADO' ? ['NO ASALARIADO', 'PERSONAL'] : [tipo]
