import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("App crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: "100vh", background: "#080A10", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
        fontFamily: "'Sora',sans-serif", color: "#E2E8F4",
      }}>
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
            Algo salió mal
          </div>
          <div style={{ fontSize: 14, color: "#94A3B8", lineHeight: 1.7, marginBottom: 24 }}>
            La aplicación encontró un error inesperado. Podés intentar recargar la página.
            Si el problema persiste, avisale al administrador.
          </div>
          <div style={{
            background: "#131720", border: "1px solid #1E2535", borderRadius: 10,
            padding: "12px 16px", marginBottom: 24, textAlign: "left",
            fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "#F87171",
            wordBreak: "break-all",
          }}>
            {this.state.error?.message || "Error desconocido"}
          </div>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              background: "#22D3EE", border: "none", borderRadius: 12,
              padding: "12px 32px", fontSize: 14, fontWeight: 800,
              color: "#080A10", cursor: "pointer",
            }}>
            Recargar aplicación
          </button>
        </div>
      </div>
    );
  }
}
