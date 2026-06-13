import { Component, createContext, useContext, type ErrorInfo, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";

type PrivyAppProviderProps = {
  children: ReactNode;
};

type PrivyRuntimeState = {
  isConfigured: boolean;
  providerError: string;
};

export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID?.trim() ?? "";
const PrivyRuntimeContext = createContext<PrivyRuntimeState>({
  isConfigured: false,
  providerError: "",
});

export function isPrivyConfigured() {
  return PRIVY_APP_ID.length > 0;
}

export function usePrivyRuntime() {
  return useContext(PrivyRuntimeContext);
}

type PrivyProviderBoundaryProps = {
  children: ReactNode;
  fallbackChildren: ReactNode;
};

type PrivyProviderBoundaryState = {
  error: Error | null;
};

class PrivyProviderBoundary extends Component<PrivyProviderBoundaryProps, PrivyProviderBoundaryState> {
  state: PrivyProviderBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[privy] provider failed", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <PrivyRuntimeContext.Provider
          value={{
            isConfigured: false,
            providerError: this.state.error.message || "Privy provider failed to initialize",
          }}
        >
          {this.props.fallbackChildren}
        </PrivyRuntimeContext.Provider>
      );
    }

    return this.props.children;
  }
}

export function PrivyAppProvider({ children }: PrivyAppProviderProps) {
  if (!isPrivyConfigured()) {
    return (
      <PrivyRuntimeContext.Provider value={{ isConfigured: false, providerError: "" }}>
        {children}
      </PrivyRuntimeContext.Provider>
    );
  }

  return (
    <PrivyProviderBoundary fallbackChildren={children}>
      <PrivyRuntimeContext.Provider value={{ isConfigured: true, providerError: "" }}>
        <PrivyProvider appId={PRIVY_APP_ID}>
          {children}
        </PrivyProvider>
      </PrivyRuntimeContext.Provider>
    </PrivyProviderBoundary>
  );
}
