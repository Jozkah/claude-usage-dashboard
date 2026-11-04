import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Small inline fallback for a single card; omit for the full-page one. */
  label?: string;
  className?: string;
}

interface State { error: Error | null }

/** Keeps one bad record from blanking the whole dashboard. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.label) {
      return (
        <div role="alert" className={`rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm ${this.props.className ?? ''}`}>
          <div className="font-medium">{this.props.label} could not be shown</div>
          <p className="mt-1 text-xs text-muted-fg">{error.message}</p>
          <button onClick={() => this.setState({ error: null })} className="mt-2 rounded-lg border border-line bg-card px-3 py-1 text-xs">Try again</button>
        </div>
      );
    }
    return (
      <div role="alert" className="grid h-full place-items-center p-6 text-center">
        <div>
          <div className="text-base font-semibold">Something went wrong</div>
          <p className="mt-1 text-sm text-muted-fg">{error.message}</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-fg">Reload</button>
        </div>
      </div>
    );
  }
}
