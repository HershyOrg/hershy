import { useEffect, useState } from "react";
import type { StrategyVaultMetadata } from "../../../../demoDB";
import { requestVaultMetadataByAddress } from "../api/strategyApi";

export function useVaultMetadata(address: string) {
  const [vaultDetails, setVaultDetails] = useState<StrategyVaultMetadata | null>(null);
  const [vaultEndpoint, setVaultEndpoint] = useState("");
  const [isVaultLoading, setIsVaultLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setVaultDetails(null);
    setIsVaultLoading(true);

    requestVaultMetadataByAddress(address)
      .then((response) => {
        if (cancelled) return;
        setVaultDetails(response.adapter);
        setVaultEndpoint(response.endpoint);
      })
      .finally(() => {
        if (!cancelled) {
          setIsVaultLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return {
    vaultDetails,
    vaultEndpoint,
    isVaultLoading,
  };
}
