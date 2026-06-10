import { useEffect, useState } from "react";
import type { VaultActivityTransactionRow, VaultActivityUserRow } from "../../../../demoDB";
import { requestVaultActivity } from "../api/strategyApi";

export function useVaultActivity(vaultAddress: string) {
  const [users, setUsers] = useState<VaultActivityUserRow[]>([]);
  const [transactions, setTransactions] = useState<VaultActivityTransactionRow[]>([]);
  const [activityEndpoint, setActivityEndpoint] = useState("");
  const [isActivityLoading, setIsActivityLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setUsers([]);
    setTransactions([]);
    setIsActivityLoading(true);

    requestVaultActivity(vaultAddress)
      .then((response) => {
        if (cancelled) return;
        setUsers(response.users);
        setTransactions(response.transactions);
        setActivityEndpoint(response.endpoint);
      })
      .finally(() => {
        if (!cancelled) {
          setIsActivityLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [vaultAddress]);

  return {
    users,
    transactions,
    activityEndpoint,
    isActivityLoading,
  };
}
