import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import AuthFlow from "./features/auth/AuthFlow";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthFlow>
        {(profile, onSignOut, authMeta) => (
          <App profile={profile} onSignOut={onSignOut} authMeta={authMeta} />
        )}
      </AuthFlow>
    </ErrorBoundary>
  </React.StrictMode>,
);
