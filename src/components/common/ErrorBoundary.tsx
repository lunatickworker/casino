import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-900">
          <div className="text-center space-y-4 p-6">
            <div className="text-red-400 text-2xl">⚠️ 오류 발생</div>
            <div className="text-white space-y-2">
              <p>예상치 못한 오류가 발생했습니다.</p>
              <details className="text-sm text-gray-400">
                <summary className="cursor-pointer">오류 세부 정보</summary>
                <pre className="mt-2 p-2 bg-gray-800 rounded text-left overflow-auto">
                  {this.state.error?.stack || this.state.error?.message}
                </pre>
              </details>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              페이지 새로고침
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}