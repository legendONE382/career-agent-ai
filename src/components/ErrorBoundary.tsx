import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  hasError: boolean;
}

/** Last-resort safety net so a rendering bug never leaves the user on a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("CareerAgent crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center bg-paper p-6 text-center">
        <div className="max-w-md">
          <p className="text-5xl">🛠️</p>
          <h1 className="mt-4 font-display text-3xl font-bold">Something went sideways</h1>
          <p className="mt-2 text-ink/65">The page hit an unexpected error. Your saved scores are safe — reload to continue.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper hover:bg-ink-3"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
