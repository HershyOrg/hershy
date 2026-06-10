import { useEffect, useState } from "react";
import type { UserAccountRow } from "../../../../demoDB";
import { requestUserAccountByAddress } from "../api/strategyApi";

export function useUserAccount(address: string) {
  const [account, setAccount] = useState<UserAccountRow | null>(null);
  const [userEndpoint, setUserEndpoint] = useState("");
  const [isUserLoading, setIsUserLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setAccount(null);
    setIsUserLoading(true);

    requestUserAccountByAddress(address)
      .then((response) => {
        if (cancelled) return;
        setAccount(response.account);
        setUserEndpoint(response.endpoint);
      })
      .finally(() => {
        if (!cancelled) {
          setIsUserLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  return {
    account,
    userEndpoint,
    isUserLoading,
  };
}
