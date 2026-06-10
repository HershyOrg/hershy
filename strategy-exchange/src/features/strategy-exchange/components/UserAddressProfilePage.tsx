import { creators } from "../store/strategyCatalog";
import { useUserAccount } from "../hooks/useUserAccount";
import { formatAddress } from "../../../shared/utils/formatters";
import { Button } from "../../../shared/components";
import { AddressRouteNotFound } from "./AddressRouteNotFound";
import { CreatorProfile } from "./CreatorProfile";

export function UserAddressProfilePage({
  address,
  onBack,
  onStrategySelect,
}: {
  address: string;
  onBack: () => void;
  onStrategySelect: (strategyId: string) => void;
}) {
  const { account, userEndpoint, isUserLoading } = useUserAccount(address);
  const creator = account ? creators[account.creatorId] ?? null : null;

  if (creator && account) {
    return (
      <div data-user-api-request={userEndpoint}>
        <CreatorProfile
          creator={creator}
          account={account}
          onBack={onBack}
          onStrategySelect={onStrategySelect}
        />
      </div>
    );
  }

  if (isUserLoading) {
    return (
      <main className="profile-layout">
        <Button variant="back" onClick={onBack}>
          Back
        </Button>
        <section className="profile-hero">
          <div>
            <span className="field-label">EOA</span>
            <h1>Loading</h1>
            <strong>{formatAddress(address)}</strong>
          </div>
        </section>
      </main>
    );
  }

  return <AddressRouteNotFound address={address} onBack={onBack} />;
}
