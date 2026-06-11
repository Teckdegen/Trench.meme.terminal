// Global error boundary. Wraps the route Outlet so a single bad render
// doesn't white-screen the whole app.

import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error("[AppErrorBoundary]", error, info);
    // Optional analytics/Sentry hook
    if (typeof window !== "undefined" && (window as any).Sentry?.captureException) {
      (window as any).Sentry.captureException(error);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[60vh] grid place-items-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="size-14 rounded-2xl bg-down/15 text-down grid place-items-center mx-auto">
            <AlertTriangle className="size-6" />
          </div>
          <h1 className="text-xl font-bold mt-4">Something broke</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            This page hit an error. Your account and trades are safe — refresh to try again.
          </p>
          <div className="mt-5 flex gap-2 justify-center">
            <button
              onClick={() => { this.reset(); window.location.reload(); }}
              className="h-10 px-5 rounded-full lit-purple text-sm font-bold inline-flex items-center gap-1.5"
            >
              <RefreshCw className="size-4" /> Reload
            </button>
            <button
              onClick={() => { this.reset(); window.history.back(); }}
              className="h-10 px-5 rounded-full bg-white/5 text-sm font-semibold"
            >
              Go back
            </button>
          </div>
          {import.meta.env.DEV && (
            <pre className="text-[10px] text-left text-muted-foreground mt-5 p-3 rounded-lg bg-black/40 overflow-auto max-h-40">
              {this.state.error.message}
              {"\n"}
              {this.state.error.stack}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
