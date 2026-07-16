import { ACCOUNT_ACTIONS } from "@/features/ai-wallet/config/walletConfig";
import type { WalletSession } from "@/features/ai-wallet/types/walletTypes";
import {
  ArrowDown,
  ChevronDown,
  Key,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  Send,
  Swap,
  Wallet,
} from "@/shared/components/icons";
import { cn } from "@/shared/utils/utils";

type WalletHeaderProps = {
  session: WalletSession;
  totalValueUsd: number;
  onOpenWallet: () => void;
  className?: string;
};

const actionIcons = {
  deposit: ArrowDown,
  swap: Swap,
  execute: Send,
  track: Plus,
};

export function WalletHeader({ session, totalValueUsd, onOpenWallet, className }: WalletHeaderProps) {
  return (
    <header className={cn("wallet-header", className)}>
      <div className="wallet-header__top">
        <div className="brand-lockup" aria-label="Thirdeye">
          <div className="brand-lockup__mark">
            <Wallet size={19} stroke={2.2} />
          </div>
          <div>
            <p className="brand-lockup__name">Thirdeye</p>
            <p className="brand-lockup__meta">Session budget</p>
          </div>
        </div>

        <div className="account-switcher" role="button" tabIndex={0}>
          <span className="account-switcher__dot" />
          <span>{session.label}</span>
          <ChevronDown size={16} />
        </div>

        <div className="network-pill">
          <Network size={15} />
          <span>{session.network}</span>
        </div>

        <button className="icon-button icon-button--mobile" type="button" onClick={onOpenWallet} title="현황">
          <Menu size={20} />
        </button>
        <button className="icon-button icon-button--desktop" type="button" onClick={onOpenWallet} title="더보기">
          <MoreHorizontal size={20} />
        </button>
      </div>

      <div className="wallet-header__account">
        <div>
          <p className="wallet-header__balance">{totalValueUsd.toLocaleString("en-US", { style: "currency", currency: "USD" })}</p>
          <p className="wallet-header__address">{session.label}</p>
        </div>
        <div className="api-key-pill">
          <Key size={15} />
          <span>Payment ready</span>
        </div>
      </div>

      <div className="wallet-actions" aria-label="Quick actions">
        {ACCOUNT_ACTIONS.map((action) => {
          const Icon = actionIcons[action.id];

          return (
            <button className="wallet-action" type="button" key={action.id} title={action.label}>
              <span className="wallet-action__icon">
                <Icon size={18} />
              </span>
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
}
