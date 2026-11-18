import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { i18n } from '../i18n';
import { ErrorScreen } from './ErrorScreen';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

// React only supports error boundaries as classes.
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <ErrorScreen
          message={`${i18n.t('errorBoundary.title')}. ${i18n.t('errorBoundary.message')}`}
          onRetry={() => this.setState({ failed: false })}
        />
      );
    }
    return this.props.children;
  }
}
