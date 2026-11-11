import { Component, type ErrorInfo, type ReactNode } from 'react'

// Si una página falla al dibujarse, muestra el motivo en lugar de dejar la pantalla en blanco.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Error en la página:', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="vacio">
          <h2>Esta página no pudo mostrarse</h2>
          <p>Recarga con Ctrl + F5. Si vuelve a pasar, envía este mensaje:</p>
          <pre className="error-detalle">{this.state.error.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
