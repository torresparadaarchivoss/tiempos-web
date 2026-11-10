import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export default function Layout() {
  const { perfil, salir } = useAuth()
  return (
    <div className="app">
      <aside className="menu">
        <img className="logo" src="brand/logo_claro.png" alt="Instacredit" />
        <nav>
          <NavLink to="/" end>Tablero</NavLink>
        </nav>
        <div className="usuario">
          <span>{perfil?.nombre ?? 'Usuario'}</span>
          <button type="button" onClick={salir}>Salir</button>
        </div>
        <p className="slogan">¡Apoyándote siempre!</p>
      </aside>
      <main className="contenido">
        <Outlet />
      </main>
    </div>
  )
}
