import { Component, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="app">
        <section className="error-panel app-error" role="alert">
          <strong>アプリでエラーが発生しました</strong>
          <p>画面を再読み込みして、もう一度お試しください。</p>
          <div className="error-actions">
            <button className="secondary-button" type="button" onClick={this.reload}>
              再読み込み
            </button>
          </div>
        </section>
      </main>
    );
  }
}
