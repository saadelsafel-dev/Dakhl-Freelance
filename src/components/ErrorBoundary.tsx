import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import logo from '../logo.png';
import { firebaseProjectInfo } from '../lib/firebase';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  isQuotaError: boolean;
  isDailyReadQuotaError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
    isQuotaError: false,
    isDailyReadQuotaError: false,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const raw = error.message || '';
    let parsedError = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed?.error) parsedError = parsed.error;
    } catch {
      // Keep raw error string
    }
    const isDailyReadQuotaError = parsedError.includes(
      "Free daily read units per project (free tier database)",
    );
    const isQuotaError = isDailyReadQuotaError || parsedError.includes('Quota exceeded');

    return {
      hasError: true,
      message: isQuotaError
        ? 'تم الوصول إلى الحد اليومي المجاني لقاعدة البيانات. سيتم تجديد الحصة في اليوم التالي.'
        : 'حدث خطأ غير متوقع أثناء الاتصال بقاعدة البيانات. يرجى المحاولة مرة أخرى.',
      isQuotaError,
      isDailyReadQuotaError,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      const upgradeUrl = `https://console.firebase.google.com/project/${firebaseProjectInfo.projectId}/firestore/databases/${firebaseProjectInfo.firestoreDatabaseId}/data?openUpgradeDialog=true`;
      return (
        <main className="auth-page" dir="rtl">
          <section className="auth-card status-card">
            <img className="auth-logo" src={logo} alt="دخل" />
            <div className="auth-message error" role="alert">
              {this.state.message}
            </div>
            {this.state.isDailyReadQuotaError && (
              <p className="auth-privacy">
                يمكنك ترقية الخطة من{' '}
                <a href={upgradeUrl} target="_blank" rel="noreferrer">
                  لوحة تحكم Firebase
                </a>
                .
              </p>
            )}
            <div className="setup-actions">
              <button
                className="auth-submit"
                type="button"
                onClick={() => window.location.reload()}
              >
                إعادة تحميل الصفحة <ArrowLeft size={17} />
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
