import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { SUGGESTED_PROMPTS } from "@/features/ai-wallet/mock-data/wallet";
import type {
  ChatMessage,
  CommerceWorkflowAction,
  GeneratedPlan,
  StrategyRun,
  TokenAsset,
  WalletSession,
  WalletTransaction,
} from "@/features/ai-wallet/types/walletTypes";
import { formatDateTime, formatUsd } from "@/features/ai-wallet/utils/formatters";
import {
  createGeneratedPlan,
  executeGeneratedPlan,
  getWalletWorkspaceSnapshot,
  refreshPortfolioSnapshot,
} from "@/shared/api/dummyApi";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  History,
  Menu,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserCircle,
  Wallet,
  X,
} from "@/shared/components/icons";
import { cn } from "@/shared/utils/utils";

type AppView = "chat" | "budget";
type RootTab = "main" | "budget" | "profile" | "session";
type FundingMethod = "bank" | "coin";
type SessionWorkspace = {
  session: WalletSession;
  messages: ChatMessage[];
  activePlan: GeneratedPlan | null;
  runs: StrategyRun[];
  transactions: WalletTransaction[];
};
type DeliveryProfile = {
  recipient: string;
  phone: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string;
  deliveryNote: string;
};

const HERO_IMAGE =
  "https://storage.googleapis.com/ployai/eb117397-bc95-4c8e-bfe1-66506d8abe24/user/624e3555-ai-generated-1784086038009.webp";

const viewItems = [
  { id: "chat", label: "Chat", icon: MessageCircle },
  { id: "budget", label: "Chat budget", icon: Wallet },
] as const;

const fundingMethodLabels: Record<FundingMethod, string> = {
  bank: "Bank transfer",
  coin: "Coin transfer",
};

function nowIso() {
  return new Date().toISOString();
}

function createMessage(role: ChatMessage["role"], content: string, planId?: string): ChatMessage {
  return {
    id: `msg-${role}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    role,
    content,
    timestamp: nowIso(),
    planId,
  };
}

function createRunFromPlan(plan: GeneratedPlan): StrategyRun {
  return {
    id: `run-${Date.now()}`,
    title: plan.title,
    status: "complete",
    mode: "one-shot",
    progress: 100,
    nextStep: "Receipts and summary saved",
    startedAt: nowIso(),
    planId: plan.id,
    budgetCategoryId: plan.budgetCategoryId,
    budgetCategoryName: plan.budgetCategoryName,
    lockedAssets: plan.lockedAssets,
  };
}

function createPurchaseFromPlan(plan: GeneratedPlan, confirmationId: string): WalletTransaction {
  return {
    id: `purchase-${Date.now()}`,
    title: "Plan completed",
    summary: `${plan.title} · confirmation ${confirmationId}`,
    hash: confirmationId,
    kind: "execute",
    status: "confirmed",
    timestamp: nowIso(),
    amountLabel: plan.totalLabel ?? "Approved spend",
  };
}

function getTotalUsd(assets: TokenAsset[]) {
  return assets.reduce((sum, asset) => sum + asset.balance * asset.fiatPrice, 0);
}

function getWorkspaceReservedUsd(workspace: SessionWorkspace) {
  const plan = workspace.activePlan;
  if (!plan || (plan.approvalStatus !== "executing" && plan.approvalStatus !== "executed")) return 0;
  const matchingRun = workspace.runs.find((run) => run.planId === plan.id);
  if (matchingRun?.status === "stopped") return 0;
  return Math.min(plan.budgetReservedUsd ?? 0, workspace.session.fundingAmount);
}

function getWorkflowActions(plan: GeneratedPlan): CommerceWorkflowAction[] {
  return plan.workflowActions ?? [];
}

function formatKrw(value: number) {
  return `₩${new Intl.NumberFormat("ko-KR").format(value)}`;
}

function getWorkflowSelection(plan: GeneratedPlan) {
  const items = getWorkflowActions(plan).flatMap((action) => action.items ?? []);
  const selectedItems = items.filter((item) => item.isSelected);

  return {
    selectedCount: selectedItems.length,
    totalCount: items.length,
    totalValue: selectedItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0),
  };
}

function getPlanStatusLabel(plan: GeneratedPlan) {
  if (plan.approvalStatus === "executed") return "Plan completed";
  if (plan.approvalStatus === "executing") return "Completing";
  return "Ready to confirm";
}

function RootNavigation({
  active,
  onOpenWallet,
  onOpenBudget,
  onOpenProfile,
}: {
  active: "wallet" | "budget" | "profile";
  onOpenWallet: () => void;
  onOpenBudget: () => void;
  onOpenProfile: () => void;
}) {
  const items = [
    { id: "wallet", label: "Wallet", icon: Wallet, onClick: onOpenWallet },
    { id: "budget", label: "Overall budget", icon: Activity, onClick: onOpenBudget },
    { id: "profile", label: "My page", icon: UserCircle, onClick: onOpenProfile },
  ] as const;

  return (
    <nav className="root-tabs" aria-label="Primary navigation">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;

        return (
          <button
            type="button"
            className={cn("root-tab-button", isActive && "root-tab-button--active")}
            onClick={item.onClick}
            aria-current={isActive ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
            key={item.id}
          >
            <Icon size={17} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function HeaderBar({
  session,
  activeView,
  onChangeView,
  onBack,
}: {
  session: WalletSession;
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  onBack: () => void;
}) {
  return (
    <header className="session-header">
      <div className="session-header__left">
        <button type="button" className="icon-button" title="뒤로가기" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="session-title-block">
          <p className="eyebrow">Thirdeye session</p>
          <strong>{session.label}</strong>
          <span>{formatUsd(session.fundingAmount)} ready</span>
        </div>
      </div>
      <div className="session-header__actions">
        <button type="button" className="icon-button" title="Chat" onClick={() => onChangeView("chat")}>
          <MessageCircle size={18} />
        </button>
        <button type="button" className="icon-button" title="Budget" onClick={() => onChangeView(activeView === "budget" ? "chat" : "budget")}>
          <Menu size={18} />
        </button>
      </div>
    </header>
  );
}

function MainWalletTab({
  sessions,
  assets,
  walletTopUpAmount,
  walletTopUpMethod,
  sessionAllocationAmount,
  onChangeWalletTopUpAmount,
  onChangeWalletTopUpMethod,
  onChangeSessionAllocationAmount,
  onTopUpWallet,
  onOpenBudget,
  onOpenProfile,
  onOpenSession,
  onStartNewSession,
}: {
  sessions: WalletSession[];
  assets: TokenAsset[];
  walletTopUpAmount: string;
  walletTopUpMethod: FundingMethod;
  sessionAllocationAmount: string;
  onChangeWalletTopUpAmount: (amount: string) => void;
  onChangeWalletTopUpMethod: (method: FundingMethod) => void;
  onChangeSessionAllocationAmount: (amount: string) => void;
  onTopUpWallet: () => void;
  onOpenBudget: () => void;
  onOpenProfile: () => void;
  onOpenSession: (sessionId: string) => void;
  onStartNewSession: () => void;
}) {
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const totalUsd = getTotalUsd(assets);
  const allocatedUsd = sessions.reduce((sum, currentSession) => sum + currentSession.fundingAmount, 0);
  const availableSessionBalance = Math.max(totalUsd - allocatedUsd, 0);
  const allocationAmountNumber = Number(sessionAllocationAmount.replace(/,/g, ""));
  const hasValidAllocation =
    Number.isFinite(allocationAmountNumber) && allocationAmountNumber > 0 && allocationAmountNumber <= availableSessionBalance;

  useEffect(() => {
    if (!isNewSessionOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsNewSessionOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isNewSessionOpen]);

  function startNewSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasValidAllocation) return;
    setIsNewSessionOpen(false);
    onStartNewSession();
  }

  return (
    <section className="main-shell" aria-label="Thirdeye wallet">
      <div className="main-hero" style={{ "--hero-image": `url(${HERO_IMAGE})` } as CSSProperties}>
        <div className="main-hero__scrim" />
        <header className="main-nav">
          <a className="brand-lockup" href="#top">
            <span />
            <strong>Thirdeye</strong>
          </a>
          <RootNavigation active="wallet" onOpenWallet={() => undefined} onOpenBudget={onOpenBudget} onOpenProfile={onOpenProfile} />
        </header>
      </div>

      <section className="wallet-home-panel">
        <div className="wallet-home-panel__header">
          <div>
            <p className="eyebrow">My wallet</p>
            <strong>{formatUsd(totalUsd)}</strong>
          </div>
          <span>Primary payment method connected</span>
        </div>
        <div className="session-grid">
          <section className="funding-setup" aria-label="Top up Thirdeye wallet">
            <div>
              <p className="eyebrow">Thirdeye balance</p>
              <strong>Add funds to Thirdeye</strong>
            </div>
            <label className="funding-amount-field">
              <span>Amount</span>
              <input
                value={walletTopUpAmount}
                onChange={(event) => onChangeWalletTopUpAmount(event.target.value)}
                inputMode="decimal"
                placeholder="500"
              />
            </label>
            <div className="funding-methods" role="group" aria-label="Funding method">
              {(["bank", "coin"] as const).map((method) => (
                <button
                  type="button"
                  key={method}
                  className={cn(walletTopUpMethod === method && "funding-methods__button--active")}
                  onClick={() => onChangeWalletTopUpMethod(method)}
                >
                  {fundingMethodLabels[method]}
                </button>
              ))}
            </div>
            <button type="button" className="wallet-top-up-button" onClick={onTopUpWallet}>
              Add to Thirdeye
            </button>
          </section>
          <div className="session-list" aria-label="Sessions">
            {sessions.map((currentSession) => (
              <button className="session-card" type="button" key={currentSession.id} onClick={() => onOpenSession(currentSession.id)}>
                <p>{currentSession.label}</p>
                <strong>{formatUsd(currentSession.fundingAmount)}</strong>
                <span>Open session</span>
              </button>
            ))}
            <button className="session-add" type="button" onClick={() => setIsNewSessionOpen(true)} title="새 세션">
              <Plus size={24} />
            </button>
          </div>
        </div>
      </section>

      {isNewSessionOpen ? (
        <div className="session-modal-backdrop" role="presentation" onMouseDown={() => setIsNewSessionOpen(false)}>
          <section
            className="session-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-session-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="session-modal__header">
              <div>
                <p className="eyebrow">New session</p>
                <h2 id="new-session-title">Allocate from Thirdeye</h2>
              </div>
              <button type="button" className="session-modal__close" onClick={() => setIsNewSessionOpen(false)} title="닫기">
                <X size={19} />
              </button>
            </header>

            <div className="session-modal__balance">
              <span>Available in Thirdeye</span>
              <strong>{formatUsd(availableSessionBalance)}</strong>
            </div>

            <form className="session-modal__form" onSubmit={startNewSession}>
              <label className="session-amount-field">
                <span>Session budget</span>
                <div>
                  <span>$</span>
                  <input
                    value={sessionAllocationAmount}
                    onChange={(event) => onChangeSessionAllocationAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder="1,200"
                    autoFocus
                  />
                </div>
              </label>
              {allocationAmountNumber > availableSessionBalance ? (
                <p className="session-modal__error">Enter an amount within your available Thirdeye balance.</p>
              ) : null}
              <p className="session-modal__note">This amount will be set aside for purchases made in this chat.</p>
              <button className="session-modal__submit" type="submit" disabled={!hasValidAllocation}>
                Start session
                <ArrowRight size={17} />
              </button>
            </form>
          </section>
        </div>
      ) : null}

    </section>
  );
}

function MyPageTab({
  profile,
  onSave,
  onOpenWallet,
  onOpenBudget,
}: {
  profile: DeliveryProfile;
  onSave: (profile: DeliveryProfile) => void;
  onOpenWallet: () => void;
  onOpenBudget: () => void;
}) {
  const [draft, setDraft] = useState(profile);
  const [isSaved, setIsSaved] = useState(false);

  function updateField(field: keyof DeliveryProfile, value: string) {
    setDraft((currentDraft) => ({ ...currentDraft, [field]: value }));
    setIsSaved(false);
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.recipient.trim() || !draft.addressLine1.trim()) return;
    onSave(draft);
    setIsSaved(true);
  }

  return (
    <section className="profile-shell" aria-label="My page">
      <header className="main-nav profile-nav">
        <button type="button" className="brand-lockup" onClick={onOpenWallet}>
          <span />
          <strong>Thirdeye</strong>
        </button>
        <RootNavigation active="profile" onOpenWallet={onOpenWallet} onOpenBudget={onOpenBudget} onOpenProfile={() => undefined} />
      </header>

      <div className="profile-content">
        <header className="profile-title">
          <p className="eyebrow">My page</p>
          <h1>Personal information</h1>
        </header>

        <form className="delivery-form profile-form" onSubmit={saveProfile}>
          <section className="profile-form__section">
            <div className="profile-form__heading">
              <h2>Contact</h2>
            </div>
            <div className="delivery-form__row">
              <label>
                <span>Recipient</span>
                <input
                  value={draft.recipient}
                  onChange={(event) => updateField("recipient", event.target.value)}
                  autoComplete="name"
                  placeholder="Full name"
                />
              </label>
              <label>
                <span>Phone</span>
                <input
                  value={draft.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="010-0000-0000"
                />
              </label>
            </div>
          </section>

          <section className="profile-form__section">
            <div className="profile-form__heading">
              <h2>Delivery address</h2>
            </div>
            <label className="profile-form__postal-code">
              <span>Postal code</span>
              <input
                value={draft.postalCode}
                onChange={(event) => updateField("postalCode", event.target.value)}
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="Postal code"
              />
            </label>
            <label>
              <span>Address</span>
              <input
                value={draft.addressLine1}
                onChange={(event) => updateField("addressLine1", event.target.value)}
                autoComplete="address-line1"
                placeholder="Street address"
              />
            </label>
            <label>
              <span>Apartment, suite, etc.</span>
              <input
                value={draft.addressLine2}
                onChange={(event) => updateField("addressLine2", event.target.value)}
                autoComplete="address-line2"
                placeholder="Optional"
              />
            </label>
            <label>
              <span>Delivery instructions</span>
              <textarea
                value={draft.deliveryNote}
                onChange={(event) => updateField("deliveryNote", event.target.value)}
                placeholder="Optional note for the courier"
              />
            </label>
          </section>

          <div className="profile-form__footer">
            <p className="delivery-form__privacy">Used only to complete purchases and deliveries you approve.</p>
            <div>
              {isSaved ? <span className="profile-form__saved">Saved</span> : null}
              <button
                className="session-modal__submit profile-form__submit"
                type="submit"
                disabled={!draft.recipient.trim() || !draft.addressLine1.trim()}
              >
                Save changes
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}

function BudgetMeters({ session, plan }: { session: WalletSession; plan: GeneratedPlan | null }) {
  const totalUsd = session.fundingAmount;
  const reservedUsd = plan?.approvalStatus === "executed" ? (plan.budgetReservedUsd ?? 0) : 0;
  const availableUsd = Math.max(totalUsd - reservedUsd, 0);
  const reservedRatio = Math.min(100, (reservedUsd / Math.max(totalUsd, 1)) * 100);

  return (
    <div className="asset-meters">
      <p className="eyebrow">Session budget</p>
      <div className="asset-meter">
        <div className="asset-meter__top">
          <span>Available</span>
          <strong>
            {formatUsd(availableUsd)} / {formatUsd(totalUsd)}
          </strong>
        </div>
        <div className="asset-meter__track">
          <span style={{ width: `${Math.max(0, 100 - reservedRatio)}%` }} />
        </div>
      </div>
      <div className="asset-meter">
        <div className="asset-meter__top">
          <span>Reserved for plans</span>
          <strong>{formatUsd(reservedUsd)}</strong>
        </div>
        <div className="asset-meter__track asset-meter__track--reserved">
          <span style={{ width: `${reservedRatio}%` }} />
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ plan, compact = false }: { plan: GeneratedPlan; compact?: boolean }) {
  const signals = plan.analysisSignals ?? ["Intent captured", "Options assembled", "Budget checked"];

  return (
    <section className={cn("analysis-panel", compact && "analysis-panel--compact")}>
      <div className="section-title">
        <Search size={16} />
        <h3>Analysis</h3>
      </div>
      <div className="signal-list">
        {signals.map((signal) => (
          <div className="signal-row" key={signal}>
            <span />
            <p>{signal}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProposedWorkflow({
  plan,
  isExecuting,
  onExecute,
  onToggleAction,
  onToggleItem,
  compact = false,
}: {
  plan: GeneratedPlan;
  isExecuting: boolean;
  onExecute: () => void;
  onToggleAction: (actionId: string) => void;
  onToggleItem: (actionId: string, itemId: string) => void;
  compact?: boolean;
}) {
  const actions = getWorkflowActions(plan);
  const completed = plan.approvalStatus === "executed";
  const selection = getWorkflowSelection(plan);
  const hasSelectableItems = selection.totalCount > 0;

  return (
    <section className={cn("proposed-actions", compact && "proposed-actions--compact")}>
      <div className="proposed-actions__header">
        <div>
          <h3>Proposed workflow</h3>
          <p>Illustrative demo · not live quotes</p>
        </div>
        <span className="status-pill">{getPlanStatusLabel(plan)}</span>
      </div>

      <div className="action-card-list">
        {actions.map((action) => {
          const items = action.items ?? [];
          const selectedItems = items.filter((item) => item.isSelected);
          const allItemsSelected = items.length > 0 && selectedItems.length === items.length;
          const actionTotal = selectedItems.reduce((sum, item) => sum + item.priceValue * item.quantity, 0);

          return (
          <article className="review-action-card" key={action.id}>
            {!items.length && action.imageUrl ? (
              <a
                className="review-action-card__media"
                href={action.sourceUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`${action.title} page preview`}
              >
                <img src={action.imageUrl} alt={action.imageAlt ?? action.title} loading="lazy" />
              </a>
            ) : null}
            <div className="review-action-card__row">
              <div className="review-action-card__icon">
                {action.status === "Skipped" ? <X size={17} /> : action.status === "Ready" ? <ArrowRight size={17} /> : <CheckCircle2 size={17} />}
              </div>
              <div>
                <strong>{action.title}</strong>
                <p>{action.detail}</p>
              </div>
              <span>{action.status}</span>
            </div>
            {items.length ? (
              <div className="workflow-product-list">
                <div className="workflow-product-list__header">
                  <span>{items.length} items</span>
                  <button type="button" onClick={() => onToggleAction(action.id)} disabled={completed || isExecuting}>
                    {allItemsSelected ? "Deselect all" : "Select all"}
                  </button>
                </div>
                {items.map((item) => (
                  <div className={cn("workflow-product-row", !item.isSelected && "workflow-product-row--excluded")} key={item.id}>
                    <label className="workflow-product-row__check" title={item.isSelected ? "구매에서 제외" : "구매에 포함"}>
                      <input
                        type="checkbox"
                        checked={item.isSelected}
                        onChange={() => onToggleItem(action.id, item.id)}
                        disabled={completed || isExecuting}
                      />
                      <span />
                    </label>
                    <a className="workflow-product-row__media" href={item.sourceUrl} target="_blank" rel="noreferrer">
                      {item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt ?? item.title} loading="lazy" /> : <span>{item.title.slice(0, 1)}</span>}
                    </a>
                    <div className="workflow-product-row__body">
                      <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                      <span>
                        Qty {item.quantity}
                        {item.detail ? ` · ${item.detail}` : ""}
                      </span>
                    </div>
                    <strong>{item.priceLabel}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="review-action-card__meta">
              <div>
                <p>Source</p>
                <strong>{action.source}</strong>
              </div>
              <div>
                <p>Timing</p>
                <strong>{action.timing}</strong>
              </div>
              <div>
                <p>Selected</p>
                <strong>{items.length ? `${selectedItems.length} of ${items.length} items selected` : action.selected}</strong>
                {action.placeName ? (
                  <span className="place-summary">
                    {action.placeName}
                    {action.placeAddress ? ` · ${action.placeAddress}` : ""}
                  </span>
                ) : null}
                {action.mapUrl ? (
                  <a className="selected-link selected-link--map" href={action.mapUrl} target="_blank" rel="noreferrer">
                    Open in Naver Map
                  </a>
                ) : null}
                {!items.length && action.previewTitle ? <span className="selected-preview-title">{action.previewTitle}</span> : null}
                {!items.length && action.sourceUrl ? (
                  <a className="selected-link" href={action.sourceUrl} target="_blank" rel="noreferrer">
                    {action.sourceUrl}
                  </a>
                ) : null}
              </div>
              <div>
                <p>Final</p>
                <strong>{items.length ? formatKrw(actionTotal) : action.final}</strong>
              </div>
            </div>
          </article>
          );
        })}
      </div>

      <div className="review-total">
        <div>
          <p>{completed ? "Demo total spent" : "Estimated total"}</p>
          <span>
            {hasSelectableItems ? `${selection.selectedCount} of ${selection.totalCount} items selected` : (plan.totalDetail ?? `${actions.length} ready actions`)}
          </span>
        </div>
        <strong>{hasSelectableItems ? formatKrw(selection.totalValue) : (plan.totalLabel ?? "Pending")}</strong>
      </div>

      <button
        className="execute-button"
        type="button"
        onClick={onExecute}
        disabled={isExecuting || completed || (hasSelectableItems && selection.selectedCount === 0)}
      >
        <Play size={18} />
        <span>{completed ? "Completed" : isExecuting ? "Completing" : "Confirm purchases"}</span>
      </button>
    </section>
  );
}

function TimelinePanel({ plan }: { plan: GeneratedPlan }) {
  if (!plan.timeline?.length) return null;

  return (
    <section className="timeline-panel">
      <div className="section-title">
        <Activity size={16} />
        <h3>Timeline</h3>
      </div>
      <div className="timeline-list">
        {plan.timeline.map((step) => (
          <article className="timeline-row" key={step.id}>
            <span>{step.time}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlanMessageCard({
  plan,
  isExecuting,
  onExecute,
  onToggleAction,
  onToggleItem,
}: {
  plan: GeneratedPlan;
  isExecuting: boolean;
  onExecute: () => void;
  onToggleAction: (actionId: string) => void;
  onToggleItem: (actionId: string, itemId: string) => void;
}) {
  return (
    <div className="plan-message-card workflow-card">
      <div className="plan-message-card__title">
        <Sparkles size={17} />
        <div>
          <strong>Thirdeye workflow</strong>
          <span>{getPlanStatusLabel(plan)}</span>
        </div>
      </div>

      <section className="workflow-intent">
        <p>Intent</p>
        <span>You</span>
        <strong>{plan.userPrompt}</strong>
      </section>

      <AnalysisPanel plan={plan} compact />

      <section className="workflow-note">
        <p>Explanation</p>
        <strong>{plan.title}</strong>
        <span>{plan.explanation ?? plan.summary}</span>
      </section>

      <TimelinePanel plan={plan} />

      <ProposedWorkflow
        plan={plan}
        isExecuting={isExecuting}
        onExecute={onExecute}
        onToggleAction={onToggleAction}
        onToggleItem={onToggleItem}
        compact
      />
    </div>
  );
}

function ChatScreen({
  messages,
  plan,
  session,
  isGenerating,
  isExecuting,
  onSubmitPrompt,
  onExecute,
  onToggleAction,
  onToggleItem,
}: {
  messages: ChatMessage[];
  plan: GeneratedPlan | null;
  session: WalletSession;
  isGenerating: boolean;
  isExecuting: boolean;
  onSubmitPrompt: (prompt: string) => void;
  onExecute: () => void;
  onToggleAction: (actionId: string) => void;
  onToggleItem: (actionId: string, itemId: string) => void;
}) {
  const [prompt, setPrompt] = useState("");

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isGenerating) return;
    setPrompt("");
    onSubmitPrompt(trimmedPrompt);
  }

  return (
    <>
      <BudgetMeters session={session} plan={plan} />
      <div className="chat-scroll">
        {messages.map((message) => (
          <article className={cn("phone-message", `phone-message--${message.role}`)} key={message.id}>
            <div className="phone-message__avatar">{message.role === "user" ? "You" : <Bot size={16} />}</div>
            <div className="phone-message__body">
              <p>{message.content}</p>
              {message.planId && plan?.id === message.planId ? (
                <PlanMessageCard
                  plan={plan}
                  isExecuting={isExecuting}
                  onExecute={onExecute}
                  onToggleAction={onToggleAction}
                  onToggleItem={onToggleItem}
                />
              ) : null}
            </div>
          </article>
        ))}

        {isGenerating ? (
          <article className="phone-message phone-message--assistant">
            <div className="phone-message__avatar">
              <Bot size={16} />
            </div>
            <div className="phone-message__body phone-message__body--typing">
              <span />
              <span />
              <span />
            </div>
          </article>
        ) : null}
      </div>

      <div className="suggestion-rail">
        {SUGGESTED_PROMPTS.map((suggestion) => (
          <button type="button" key={suggestion} onClick={() => setPrompt(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>

      <form className="phone-composer" onSubmit={submitPrompt}>
        <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask Thirdeye to book, buy, or plan something" />
        <button type="submit" disabled={!prompt.trim() || isGenerating} title="전송">
          <Send size={18} />
        </button>
      </form>
    </>
  );
}

function ChatBudgetScreen({ workspace, onStopRun }: { workspace: SessionWorkspace; onStopRun: (runId: string) => void }) {
  const allocatedUsd = workspace.session.fundingAmount;
  const reservedUsd = getWorkspaceReservedUsd(workspace);
  const remainingUsd = Math.max(allocatedUsd - reservedUsd, 0);
  const remainingRatio = Math.round((remainingUsd / Math.max(allocatedUsd, 1)) * 100);

  return (
    <div className="wallet-screen budget-screen chat-budget-screen">
      <div className="screen-title">
        <div>
          <p className="eyebrow">Chat budget</p>
          <h2>{formatUsd(remainingUsd)}</h2>
          <span>available in {workspace.session.label}</span>
        </div>
      </div>

      <section className="net-worth-block">
        <div className="donut-chart" style={{ "--locked": `${Math.min(100, 100 - remainingRatio)}%` } as CSSProperties}>
          <span>{remainingRatio}%</span>
        </div>
        <div>
          <p>Remaining</p>
          <strong>{formatUsd(remainingUsd)}</strong>
          <span>{formatUsd(reservedUsd)} reserved and cancelable in this chat</span>
        </div>
      </section>

      <section className="panel-block budget-summary-grid" aria-label="Chat budget summary">
        <div>
          <span>Allocated</span>
          <strong>{formatUsd(allocatedUsd)}</strong>
        </div>
        <div>
          <span>Remaining</span>
          <strong>{formatUsd(remainingUsd)}</strong>
        </div>
        <div>
          <span>Reserved</span>
          <strong>{formatUsd(reservedUsd)}</strong>
        </div>
      </section>

      <section className="panel-block">
        <div className="section-row-title">
          <h3>Plans in this chat</h3>
          <Activity size={15} />
        </div>
        {workspace.runs.length ? (
          workspace.runs.map((run) => (
            <article className="compact-run-row" key={run.id}>
              <div className="compact-run-row__main">
                <strong>{run.title}</strong>
                <p>{run.nextStep}</p>
              </div>
              {run.status === "running" ? (
                <button type="button" onClick={() => onStopRun(run.id)} title="Stop plan">
                  <Pause size={15} />
                </button>
              ) : (
                <span>{run.status}</span>
              )}
            </article>
          ))
        ) : (
          <p className="budget-empty-copy">No purchases or reservations in this chat yet.</p>
        )}
      </section>

      {workspace.transactions.length ? (
        <section className="last-tx-block purchase-history">
          <div className="section-row-title">
            <h3>This chat's purchase history</h3>
            <History size={15} />
          </div>
          {workspace.transactions.map((transaction) => (
            <article className="purchase-row" key={transaction.id}>
              <div>
                <strong>{transaction.title}</strong>
                <p>{transaction.summary}</p>
                <span>{formatDateTime(transaction.timestamp)}</span>
              </div>
              <em>{transaction.amountLabel}</em>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function OverallBudgetTab({
  assets,
  workspaces,
  isRefreshing,
  lastRefreshLabel,
  onRefresh,
  onOpenWallet,
  onOpenProfile,
  onOpenChatBudget,
}: {
  assets: TokenAsset[];
  workspaces: SessionWorkspace[];
  isRefreshing: boolean;
  lastRefreshLabel: string;
  onRefresh: () => void;
  onOpenWallet: () => void;
  onOpenProfile: () => void;
  onOpenChatBudget: (sessionId: string) => void;
}) {
  const totalUsd = getTotalUsd(assets);
  const allocatedUsd = workspaces.reduce((sum, workspace) => sum + workspace.session.fundingAmount, 0);
  const reservedUsd = workspaces.reduce((sum, workspace) => sum + getWorkspaceReservedUsd(workspace), 0);
  const availableToAllocateUsd = Math.max(totalUsd - allocatedUsd, 0);
  const unallocatedRatio = Math.round((availableToAllocateUsd / Math.max(totalUsd, 1)) * 100);

  return (
    <section className="profile-shell overall-budget-shell" aria-label="Overall budget">
      <header className="main-nav profile-nav">
        <button type="button" className="brand-lockup" onClick={onOpenWallet}>
          <span />
          <strong>Thirdeye</strong>
        </button>
        <RootNavigation active="budget" onOpenWallet={onOpenWallet} onOpenBudget={() => undefined} onOpenProfile={onOpenProfile} />
      </header>

      <div className="overall-budget-content">
        <div className="screen-title">
          <div>
            <p className="eyebrow">Overall budget</p>
            <h2>{formatUsd(totalUsd)}</h2>
            <span>across {workspaces.length} chat{workspaces.length === 1 ? "" : "s"}</span>
          </div>
          <button className={cn("mini-button", isRefreshing && "mini-button--active")} type="button" onClick={onRefresh}>
            <RefreshCw size={14} />
            {lastRefreshLabel}
          </button>
        </div>

        <section className="overall-budget-summary">
          <div className="donut-chart" style={{ "--locked": `${Math.min(100, 100 - unallocatedRatio)}%` } as CSSProperties}>
            <span>{unallocatedRatio}%</span>
          </div>
          <div>
            <span>Available for new chats</span>
            <strong>{formatUsd(availableToAllocateUsd)}</strong>
          </div>
          <div>
            <span>Allocated to chats</span>
            <strong>{formatUsd(allocatedUsd)}</strong>
          </div>
          <div>
            <span>Reserved in plans</span>
            <strong>{formatUsd(reservedUsd)}</strong>
          </div>
        </section>

        <section className="overall-chat-list">
          <div className="section-row-title">
            <h3>Budget by chat</h3>
            <span>Select a chat to open its budget</span>
          </div>
          {workspaces.map((workspace) => {
            const chatReservedUsd = getWorkspaceReservedUsd(workspace);
            const chatRemainingUsd = Math.max(workspace.session.fundingAmount - chatReservedUsd, 0);

            return (
              <button
                type="button"
                className="overall-chat-row"
                onClick={() => onOpenChatBudget(workspace.session.id)}
                key={workspace.session.id}
              >
                <div>
                  <strong>{workspace.session.label}</strong>
                  <span>{workspace.activePlan?.title ?? "No active plan"}</span>
                </div>
                <div className="overall-chat-row__metrics">
                  <span>
                    <small>Allocated</small>
                    <strong>{formatUsd(workspace.session.fundingAmount)}</strong>
                  </span>
                  <span>
                    <small>Remaining</small>
                    <strong>{formatUsd(chatRemainingUsd)}</strong>
                  </span>
                  <span>
                    <small>Reserved</small>
                    <strong>{formatUsd(chatReservedUsd)}</strong>
                  </span>
                </div>
                <ArrowRight size={18} />
              </button>
            );
          })}
        </section>
      </div>
    </section>
  );
}

export default function WalletChatPage() {
  const [rootTab, setRootTab] = useState<RootTab>("main");
  const [activeView, setActiveView] = useState<AppView>("chat");
  const [sessionWorkspaces, setSessionWorkspaces] = useState<SessionWorkspace[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [assets, setAssets] = useState<TokenAsset[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshLabel, setLastRefreshLabel] = useState("60s");
  const [walletTopUpAmount, setWalletTopUpAmount] = useState("500");
  const [walletTopUpMethod, setWalletTopUpMethod] = useState<FundingMethod>("bank");
  const [sessionAllocationAmount, setSessionAllocationAmount] = useState("1200");
  const [deliveryProfile, setDeliveryProfile] = useState<DeliveryProfile>({
    recipient: "",
    phone: "",
    postalCode: "",
    addressLine1: "",
    addressLine2: "",
    deliveryNote: "",
  });
  const activeWorkspace = sessionWorkspaces.find((workspace) => workspace.session.id === activeSessionId) ?? null;
  const session = activeWorkspace?.session ?? null;
  const messages = activeWorkspace?.messages ?? [];
  const activePlan = activeWorkspace?.activePlan ?? null;

  useEffect(() => {
    let mounted = true;

    getWalletWorkspaceSnapshot().then((snapshot) => {
      if (!mounted) return;
      setSessionWorkspaces([
        {
          session: snapshot.session,
          messages: snapshot.messages,
          activePlan: snapshot.activePlan,
          runs:
            snapshot.activePlan.approvalStatus === "executed"
              ? snapshot.runs.filter((run) => run.planId === snapshot.activePlan.id)
              : [],
          transactions:
            snapshot.activePlan.approvalStatus === "executed"
              ? snapshot.transactions.filter((transaction) => !transaction.title.includes("Amazon"))
              : [],
        },
      ]);
      setActiveSessionId(snapshot.session.id);
      setAssets(snapshot.assets);
      setSessionAllocationAmount(String(snapshot.session.fundingAmount));
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshAssets();
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  async function refreshAssets() {
    setIsRefreshing(true);
    const refreshedAssets = await refreshPortfolioSnapshot();
    setAssets((currentAssets) => {
      const refreshedById = new Map(refreshedAssets.map((asset) => [asset.id, asset]));

      return currentAssets.map((asset) => refreshedById.get(asset.id) ?? asset);
    });
    setLastRefreshLabel(new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date()));
    setIsRefreshing(false);
  }

  async function handleSubmitPrompt(prompt: string) {
    if (!activeWorkspace || !activeSessionId) return;

    const targetSessionId = activeSessionId;
    const isFirstPrompt = activeWorkspace.messages.length === 0;
    setSessionWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.session.id === targetSessionId
          ? { ...workspace, messages: [...workspace.messages, createMessage("user", prompt)] }
          : workspace,
      ),
    );
    setIsGenerating(true);

    try {
      const plan = await createGeneratedPlan(prompt);
      setSessionWorkspaces((currentWorkspaces) =>
        currentWorkspaces.map((workspace) =>
          workspace.session.id === targetSessionId
            ? {
                ...workspace,
                session: isFirstPrompt ? { ...workspace.session, label: plan.title } : workspace.session,
                activePlan: plan,
                messages: [
                  ...workspace.messages,
                  createMessage("assistant", "플랜을 만들었어요. 아래에서 실행 항목과 타임라인을 확인해 주세요.", plan.id),
                ],
              }
            : workspace,
        ),
      );
      if (plan.budgetCategoryId) {
        setAssets((currentAssets) =>
          currentAssets.map((asset) =>
            asset.id === plan.budgetCategoryId
              ? {
                  ...asset,
                  name: plan.budgetCategoryName ?? asset.name,
                  summary: plan.summary,
                  firstPrompt: prompt,
                  balance: plan.budgetAllocatedUsd ?? asset.balance,
                }
              : asset,
          ),
        );
      }
      setActiveView("chat");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleExecutePlan() {
    if (!activePlan || !activeSessionId) return;

    const targetSessionId = activeSessionId;
    const planToExecute = activePlan;
    setIsExecuting(true);
    setSessionWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.session.id === targetSessionId
          ? { ...workspace, activePlan: { ...planToExecute, approvalStatus: "executing" } }
          : workspace,
      ),
    );

    try {
      const result = await executeGeneratedPlan(planToExecute);
      setSessionWorkspaces((currentWorkspaces) =>
        currentWorkspaces.map((workspace) =>
          workspace.session.id === targetSessionId
            ? {
                ...workspace,
                activePlan: result.plan,
                runs: [createRunFromPlan(result.plan), ...workspace.runs],
                transactions: [createPurchaseFromPlan(result.plan, result.confirmationId), ...workspace.transactions],
              }
            : workspace,
        ),
      );
      if (result.plan.budgetCategoryId) {
        setAssets((currentAssets) =>
          currentAssets.map((asset) =>
            asset.id === result.plan.budgetCategoryId
              ? {
                  ...asset,
                  lockedBalance: result.plan.budgetReservedUsd ?? asset.lockedBalance,
                }
              : asset,
          ),
        );
      }
      setRootTab("session");
      setActiveView("chat");
    } finally {
      setIsExecuting(false);
    }
  }

  function handleToggleWorkflowItem(actionId: string, itemId: string) {
    if (!activeSessionId) return;

    setSessionWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.session.id === activeSessionId && workspace.activePlan
          ? {
              ...workspace,
              activePlan: {
                ...workspace.activePlan,
                workflowActions: workspace.activePlan.workflowActions?.map((action) =>
                  action.id === actionId
                    ? {
                        ...action,
                        items: action.items?.map((item) =>
                          item.id === itemId ? { ...item, isSelected: !item.isSelected } : item,
                        ),
                      }
                    : action,
                ),
              },
            }
          : workspace,
      ),
    );
  }

  function handleToggleWorkflowAction(actionId: string) {
    if (!activeSessionId) return;

    setSessionWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.session.id === activeSessionId && workspace.activePlan
          ? {
              ...workspace,
              activePlan: {
                ...workspace.activePlan,
                workflowActions: workspace.activePlan.workflowActions?.map((action) => {
                  if (action.id !== actionId || !action.items?.length) return action;
                  const shouldSelect = !action.items.every((item) => item.isSelected);

                  return {
                    ...action,
                    items: action.items.map((item) => ({ ...item, isSelected: shouldSelect })),
                  };
                }),
              },
            }
          : workspace,
      ),
    );
  }

  function handleStopRun(runId: string) {
    if (!activeSessionId) return;

    setSessionWorkspaces((currentWorkspaces) =>
      currentWorkspaces.map((workspace) =>
        workspace.session.id === activeSessionId
          ? {
              ...workspace,
              runs: workspace.runs.map((run) =>
                run.id === runId
                  ? { ...run, status: "stopped", progress: 100, nextStep: "Reserved budget returned" }
                  : run,
              ),
              transactions: [
                {
                  id: `purchase-stop-${Date.now()}`,
                  title: "Plan stopped",
                  summary: "Reserved budget was returned to the chat balance.",
                  hash: `receipt:${runId}`,
                  kind: "release",
                  status: "confirmed",
                  timestamp: nowIso(),
                  amountLabel: "returned",
                },
                ...workspace.transactions,
              ],
            }
          : workspace,
      ),
    );
  }

  function handleTopUpWallet() {
    const parsedTopUpAmount = Number(walletTopUpAmount.replace(/,/g, ""));
    if (!Number.isFinite(parsedTopUpAmount) || parsedTopUpAmount <= 0) return;

    setAssets((currentAssets) =>
      currentAssets.map((asset) =>
        asset.id === "asset-cash"
          ? {
              ...asset,
              balance: asset.balance + parsedTopUpAmount,
              summary: `Added by ${fundingMethodLabels[walletTopUpMethod]}. Available for future sessions.`,
            }
          : asset,
      ),
    );
  }

  function handleOpenSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setRootTab("session");
    setActiveView("chat");
  }

  function handleStartNewSession() {
    const parsedAllocationAmount = Number(sessionAllocationAmount.replace(/,/g, ""));
    if (!Number.isFinite(parsedAllocationAmount) || parsedAllocationAmount <= 0) return;

    const timestamp = Date.now();
    const templateSession = sessionWorkspaces[0]?.session;
    const newSession: WalletSession = {
      id: `session-${timestamp}`,
      label: `Session ${sessionWorkspaces.length + 1}`,
      apiKeyAlias: templateSession?.apiKeyAlias ?? "payment-ready",
      eoaAddress: templateSession?.eoaAddress ?? "primary-payment-method",
      scwAddress: `session-budget-${timestamp}`,
      network: templateSession?.network ?? "Thirdeye Commerce",
      status: "ready",
      createdAt: nowIso(),
      fundingAsset: "USD",
      fundingAmount: parsedAllocationAmount,
      gasBudgetUsd: 0,
    };

    setSessionWorkspaces((currentWorkspaces) => [
      ...currentWorkspaces,
      { session: newSession, messages: [], activePlan: null, runs: [], transactions: [] },
    ]);
    setActiveSessionId(newSession.id);
    setSessionAllocationAmount("500");

    setRootTab("session");
    setActiveView("chat");
  }

  if (!session || !activeWorkspace) {
    return (
      <main className="app-loading">
        <div>
          <Wallet size={30} />
        </div>
      </main>
    );
  }

  return (
    <main className="wallet-app">
      {rootTab === "main" ? (
        <MainWalletTab
          sessions={sessionWorkspaces.map((workspace) => workspace.session)}
          assets={assets}
          walletTopUpAmount={walletTopUpAmount}
          walletTopUpMethod={walletTopUpMethod}
          sessionAllocationAmount={sessionAllocationAmount}
          onChangeWalletTopUpAmount={setWalletTopUpAmount}
          onChangeWalletTopUpMethod={setWalletTopUpMethod}
          onChangeSessionAllocationAmount={setSessionAllocationAmount}
          onTopUpWallet={handleTopUpWallet}
          onOpenBudget={() => setRootTab("budget")}
          onOpenProfile={() => setRootTab("profile")}
          onOpenSession={handleOpenSession}
          onStartNewSession={handleStartNewSession}
        />
      ) : rootTab === "profile" ? (
        <MyPageTab
          profile={deliveryProfile}
          onSave={setDeliveryProfile}
          onOpenWallet={() => setRootTab("main")}
          onOpenBudget={() => setRootTab("budget")}
        />
      ) : rootTab === "budget" ? (
        <OverallBudgetTab
          assets={assets}
          workspaces={sessionWorkspaces}
          isRefreshing={isRefreshing}
          lastRefreshLabel={lastRefreshLabel}
          onRefresh={() => void refreshAssets()}
          onOpenWallet={() => setRootTab("main")}
          onOpenProfile={() => setRootTab("profile")}
          onOpenChatBudget={(sessionId) => {
            setActiveSessionId(sessionId);
            setActiveView("budget");
            setRootTab("session");
          }}
        />
      ) : (
        <section className="session-shell" aria-label="Thirdeye chatbot">
          <HeaderBar
            session={session}
            activeView={activeView}
            onChangeView={setActiveView}
            onBack={() => {
              setRootTab("main");
              setActiveView("chat");
            }}
          />

          <div className="view-switcher" role="tablist" aria-label="Session views">
            {viewItems.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  type="button"
                  key={item.id}
                  className={cn(activeView === item.id && "view-switcher__button--active")}
                  onClick={() => setActiveView(item.id)}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="session-content">
            {activeView === "chat" ? (
              <ChatScreen
                messages={messages}
                plan={activePlan}
                session={session}
                isGenerating={isGenerating}
                isExecuting={isExecuting}
                onSubmitPrompt={handleSubmitPrompt}
                onExecute={() => void handleExecutePlan()}
                onToggleAction={handleToggleWorkflowAction}
                onToggleItem={handleToggleWorkflowItem}
              />
            ) : null}

            {activeView === "budget" ? (
              <ChatBudgetScreen workspace={activeWorkspace} onStopRun={handleStopRun} />
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}
