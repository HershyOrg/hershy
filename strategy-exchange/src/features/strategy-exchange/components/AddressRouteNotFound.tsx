import { formatAddress } from "../../../shared/utils/formatters";
import { Button } from "../../../shared/components";

export function AddressRouteNotFound({ address, onBack }: { address: string; onBack: () => void }) {
  return (
    <main className="profile-layout">
      <Button variant="back" onClick={onBack}>
        Back
      </Button>
      <section className="profile-hero">
        <div>
          <span className="field-label">Address</span>
          <h1>Not Found</h1>
          <strong>{formatAddress(address)}</strong>
        </div>
      </section>
    </main>
  );
}
