import { useState } from 'react'
import { useAuth } from '../lib/auth'
import Resumen from './Resumen'
import Cuellos from './Cuellos'

// Tablero de tiempos de formalización.
// El país lo elige el usuario en el filtro (igual que en Streamlit). La lista sale de la base
// (tabla pais, filtrada por RLS a los países asignados); nada de esto está fijo en la página.
// Secciones: Resumen y Cuellos listas. Pendientes: Insights, Abiertas, Consulta, Equipo y DAC, Parámetros.
const SECCIONES = [
  { id: 'resumen', titulo: 'Resumen' },
  { id: 'cuellos', titulo: 'Cuellos y reprocesos' },
] as const

export default function Tablero() {
  const { paises } = useAuth()
  const [elegido, setElegido] = useState<number | null>(null)
  const [seccion, setSeccion] = useState<(typeof SECCIONES)[number]['id']>('resumen')

  if (paises.length === 0) {
    return (
      <div className="vacio">
        <h1>Sin países asignados</h1>
        <p>Tu cuenta todavía no tiene acceso a ningún país. Pedí a un administrador que te lo asigne.</p>
      </div>
    )
  }

  // Si no ha elegido nada, o el país elegido ya no está en su lista, usa el primero disponible
  const activo = paises.find((p) => p.id_pais === elegido) ?? paises[0]

  return (
    <section>
      <div className="encabezado-filtro">
        <h1>Tiempos de formalización</h1>
        <label className="filtro-select">
          País
          <select value={activo.id_pais} onChange={(e) => setElegido(Number(e.target.value))}>
            {paises.map((p) => (
              <option key={p.id_pais} value={p.id_pais}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <nav className="pestanas" aria-label="Secciones">
        {SECCIONES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={seccion === s.id ? 'pestana activa' : 'pestana'}
            aria-pressed={seccion === s.id}
            onClick={() => setSeccion(s.id)}
          >
            {s.titulo}
          </button>
        ))}
      </nav>

      {seccion === 'resumen' && <Resumen pais={activo} />}
      {seccion === 'cuellos' && <Cuellos pais={activo} />}
    </section>
  )
}
