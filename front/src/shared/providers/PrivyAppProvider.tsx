import { Component, createContext, useContext, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { SmartWalletsProvider, useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import {
  createScwPolicyId,
  prepareScwOnboarding,
} from "@/features/scw-onboarding/api/scwOnboardingClient";
import { createScwChain } from "@/shared/config/scwConfig";

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

function ScwOnboardingSync() {
  const { authenticated, ready, user } = usePrivy();
  const { client } = useSmartWallets();
  const syncedKeyRef = useRef("");
  const ownerAddress = user?.wallet?.address || "";
  const smartWalletAddress = client?.account?.address || "";

  useEffect(() => {
    if (!ready || !authenticated || !ownerAddress || !smartWalletAddress) return;

    const syncKey = `${ownerAddress}:${smartWalletAddress}`;
    if (syncedKeyRef.current === syncKey) return;
    syncedKeyRef.current = syncKey;

    void prepareScwOnboarding(
      ownerAddress,
      smartWalletAddress,
      createScwPolicyId(smartWalletAddress),
    ).catch((error) => {
      syncedKeyRef.current = "";
      console.error("[scw] onboarding sync failed", error);
    });
  }, [authenticated, ownerAddress, ready, smartWalletAddress]);

  return null;
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
        <PrivyProvider
          appId={PRIVY_APP_ID}
          config={{
            defaultChain: createScwChain(),
            supportedChains: [createScwChain()],
            embeddedWallets: {
              ethereum: {
                createOnLogin: "users-without-wallets",
              },
            },
          }}
        >
          <SmartWalletsProvider>
            <ScwOnboardingSync />
            {children}
          </SmartWalletsProvider>
        </PrivyProvider>
      </PrivyRuntimeContext.Provider>
    </PrivyProviderBoundary>
  );
}
