import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { sb } from '../lib/supabase'

// Parámetros: usuarios (canal, rol, activo), reglas (SLA y roles DAC) y asuetos por país.
// Los cambios se guardan en Supabase; RLS solo permite hacerlos a los administradores del país.
const ROLES = ['', 'ANALISTA', 'DAC', 'JEFATURA DAC', 'JEFATURA', 'OTRO']
type Usuario = { usuario: string; canal: string | null; rol: string | null; activo: boolean }
type Asueto = { fecha: string; descripcion: string | null }

export default function Parametros() {
  const { pais } = useOutletContext<{ pais: { id_pais: number; nombre: string } }>()
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [sinClasificar, setSinClasificar] = useState<string[]>([])
  const [sla, setSla] = useState('24')
  const [rolesDac, setRolesDac] = useState('DAC')
  const [asuetos, setAsuetos] = useState<Asueto[]>([])
  const [nuevoAsueto, setNuevoAsueto] = useState({ fecha: '', descripcion: '' })
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  async function cargar() {
    setCargando(true)
    const [u, real, p, a] = await Promise.all([
      sb.from('usuario_operativo').select('usuario, canal, rol, activo').eq('id_pais', pais.id_pais).order('usuario'),
      sb.from('usuario_real').select('nombre').eq('id_pais', pais.id_pais),
      sb.from('parametro_pais').select('clave, valor').eq('id_pais', pais.id_pais),
      sb.from('asueto').select('fecha, descripcion').eq('id_pais', pais.id_pais).order('fecha'),
    ])
    const clasificados = new Set((u.data ?? []).map((x: Usuario) => x.usuario))
    setUsuarios((u.data as Usuario[]) ?? [])
    setSinClasificar([...new Set((real.data ?? []).map((x: { nombre: string }) => x.nombre))]
      .filter((n) => n && !clasificados.has(n)).sort())
    const par = Object.fromEntries((p.data ?? []).map((x: { clave: string; valor: string }) => [x.clave, x.valor]))
    setSla(par.SLA_HH ?? '24')
    setRolesDac(par.ROLES_DAC ?? 'DAC')
    setAsuetos((a.data as Asueto[]) ?? [])
    setCargando(false)
  }

  useEffect(() => { cargar() }, [pais.id_pais])

  function avisar(texto: string, ok: boolean) {
    setMensaje((ok ? '✔ ' : '✖ ') + texto)
    setTimeout(() => setMensaje(null), 4000)
  }

  async function guardarUsuario(u: Usuario) {
    const { error } = await sb.from('usuario_operativo').upsert({
      id_pais: pais.id_pais, usuario: u.usuario, canal: u.canal || null, rol: u.rol || null, activo: u.activo,
    })
    avisar(error ? 'No se pudo guardar: ' + error.message : `Guardado: ${u.usuario}`, !error)
    if (!error) cargar()
  }

  async function guardarReglas() {
    const { error } = await sb.from('parametro_pais').upsert([
      { id_pais: pais.id_pais, clave: 'SLA_HH', valor: sla },
      { id_pais: pais.id_pais, clave: 'ROLES_DAC', valor: rolesDac },
    ])
    avisar(error ? 'No se pudieron guardar las reglas: ' + error.message : 'Reglas guardadas', !error)
  }

  async function agregarAsueto() {
    if (!nuevoAsueto.fecha) return
    const { error } = await sb.from('asueto').upsert({
      id_pais: pais.id_pais, fecha: nuevoAsueto.fecha, descripcion: nuevoAsueto.descripcion || null,
    })
    avisar(error ? 'No se pudo agregar: ' + error.message : 'Asueto agregado', !error)
    if (!error) { setNuevoAsueto({ fecha: '', descripcion: '' }); cargar() }
  }

  async function quitarAsueto(fecha: string) {
    const { error } = await sb.from('asueto').delete().eq('id_pais', pais.id_pais).eq('fecha', fecha)
    avisar(error ? 'No se pudo quitar: ' + error.message : 'Asueto quitado', !error)
    if (!error) cargar()
  }

  function cambiar(usuario: string, campo: keyof Usuario, valor: string | boolean) {
    setUsuarios((lista) => lista.map((x) => (x.usuario === usuario ? { ...x, [campo]: valor } : x)))
  }

  if (cargando) return <p className="cargando">Cargando parámetros de {pais.nombre}…</p>

  return (
    <div className="resumen">
      {mensaje && <div className="aviso-guardado">{mensaje}</div>}

      <div className="tarjeta-seccion">
        <h2>Reglas</h2>
        <p className="sub">SLA en horas hábiles y roles que cuentan como gestión DAC</p>
        <div className="filtros-resumen">
          <label>SLA (HH)<input type="number" min="1" value={sla} onChange={(e) => setSla(e.target.value)} /></label>
          <label>Roles DAC (separados por coma)<input type="text" value={rolesDac} onChange={(e) => setRolesDac(e.target.value.toUpperCase())} /></label>
          <button type="button" className="pestana activa" onClick={guardarReglas}>Guardar reglas</button>
        </div>
      </div>

      <div className="tarjeta-seccion">
        <h2>Usuarios clasificados</h2>
        <p className="sub">Canal, rol y si está activo. Los inactivos no cuentan en Equipo y DAC.</p>
        <div className="tabla-scroll">
          <table>
            <thead><tr><th>Usuario</th><th>Canal</th><th>Rol</th><th>Activo</th><th></th></tr></thead>
            <tbody>{usuarios.map((u) => (
              <tr key={u.usuario}>
                <td>{u.usuario}</td>
                <td><input type="text" value={u.canal ?? ''} onChange={(e) => cambiar(u.usuario, 'canal', e.target.value)} /></td>
                <td>
                  <select value={u.rol ?? ''} onChange={(e) => cambiar(u.usuario, 'rol', e.target.value)}>
                    {ROLES.map((r) => <option key={r} value={r}>{r || 'Sin rol'}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" checked={u.activo} onChange={(e) => cambiar(u.usuario, 'activo', e.target.checked)} /></td>
                <td><button type="button" className="pestana" onClick={() => guardarUsuario(u)}>Guardar</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className="tarjeta-seccion">
        <h2>Sin clasificar</h2>
        <p className="sub">{sinClasificar.length} usuarios aparecen en los datos y no están en la tabla. Asígnales canal y rol.</p>
        {sinClasificar.length === 0 ? <p className="sub">Todos los usuarios están clasificados.</p> : (
          <div className="grupo-roles">
            {sinClasificar.map((n) => (
              <button key={n} type="button" className="pestana" onClick={() => guardarUsuario({ usuario: n, canal: '', rol: 'ANALISTA', activo: true })}>
                + {n}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tarjeta-seccion">
        <h2>Asuetos</h2>
        <p className="sub">Días sin horas hábiles. Afectan los días de respuesta del tablero.</p>
        <table>
          <thead><tr><th>Fecha</th><th>Descripción</th><th></th></tr></thead>
          <tbody>{asuetos.map((a) => (
            <tr key={a.fecha}><td>{a.fecha}</td><td>{a.descripcion}</td>
              <td><button type="button" className="pestana" onClick={() => quitarAsueto(a.fecha)}>Quitar</button></td></tr>
          ))}</tbody>
        </table>
        <div className="filtros-resumen">
          <label>Fecha<input type="date" value={nuevoAsueto.fecha} onChange={(e) => setNuevoAsueto({ ...nuevoAsueto, fecha: e.target.value })} /></label>
          <label>Descripción<input type="text" value={nuevoAsueto.descripcion} onChange={(e) => setNuevoAsueto({ ...nuevoAsueto, descripcion: e.target.value })} /></label>
          <button type="button" className="pestana activa" onClick={agregarAsueto}>Agregar asueto</button>
        </div>
      </div>
    </div>
  )
}
