"use client";

import { type Dispatch, type SetStateAction } from "react";
import { X } from "@/shared/components/icons";
import { cn } from "@/shared/utils/utils";
import type { ExchangeConnection, ExchangeConnectionCredentials, ExchangeFormState } from "../types/homeTypes";

type ExchangeLibraryModalProps = {
  isOpen: boolean;
  exchangeConnections: ExchangeConnection[];
  exchangeConnectionNames: string;
  selectedExchangeId?: string;
  selectedExchangeName: string;
  selectedExchangeCredentials?: ExchangeConnectionCredentials;
  isSelectedExchangePolymarket: boolean;
  isSelectedExchangeOKX: boolean;
  isSelectedExchangeBinance: boolean;
  canTestBinanceAuth: boolean;
  hasPendingBinanceCredentialInput: boolean;
  exchangeForm: ExchangeFormState;
  setExchangeForm: Dispatch<SetStateAction<ExchangeFormState>>;
  exchangeFormError: string;
  exchangeAuthMessage: string;
  isTestingExchangeAuth: boolean;
  isSavingExchange: boolean;
  hasExchangeExecutionUrl: boolean;
  onSelectExchange: (exchange: ExchangeConnection) => void;
  onTestBinanceAuth: () => void;
  onSaveExchangeConnection: () => void;
  onClose: () => void;
};

export function ExchangeLibraryModal({
  isOpen,
  exchangeConnections,
  exchangeConnectionNames,
  selectedExchangeId,
  selectedExchangeName,
  selectedExchangeCredentials,
  isSelectedExchangePolymarket,
  isSelectedExchangeOKX,
  isSelectedExchangeBinance,
  canTestBinanceAuth,
  hasPendingBinanceCredentialInput,
  exchangeForm,
  setExchangeForm,
  exchangeFormError,
  exchangeAuthMessage,
  isTestingExchangeAuth,
  isSavingExchange,
  hasExchangeExecutionUrl,
  onSelectExchange,
  onTestBinanceAuth,
  onSaveExchangeConnection,
  onClose,
}: ExchangeLibraryModalProps) {
  const updateExchangeForm = (patch: Partial<ExchangeFormState>) => {
    setExchangeForm((prev) => ({ ...prev, ...patch }));
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4">
      <section className="flex max-h-[82vh] w-full max-w-3xl flex-col border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-violet-600">Exchange Setup</div>
            <h2 className="mt-1 text-xl font-black text-slate-950">Exchange Connections</h2>
            <p className="mt-1 text-xs text-slate-500">Only required inputs are shown. Supported exchanges: {exchangeConnectionNames}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)] overflow-hidden">
          <aside className="overflow-auto border-r border-slate-200 bg-white">
            <div>
              {exchangeConnections.map((exchange) => (
                <button
                  key={exchange.id}
                  type="button"
                  onClick={() => onSelectExchange(exchange)}
                  className={cn(
                    "w-full border-b border-slate-200 px-3 py-2 text-left transition-colors",
                    exchange.id === selectedExchangeId
                      ? "border-l-2 border-l-violet-500 bg-slate-50"
                      : "hover:bg-slate-50",
                  )}
                >
                  <div className="text-sm font-black text-slate-950">{exchange.name}</div>
                  <div className={cn(
                    "mt-1 text-[10px] font-bold",
                    exchange.status === "Connected" || exchange.status === "Saved" || exchange.status === "Synced" ? "text-emerald-600" : "text-slate-400",
                  )}>
                    {exchange.status}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <div className="overflow-auto p-4">
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-950">{selectedExchangeName}</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                    {isSelectedExchangePolymarket
                      ? "Required: L1 Private Key, Funder Address"
                      : isSelectedExchangeOKX
                        ? "Required: API Key, Secret, Passphrase"
                        : "Required: API Key, Secret"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSaveExchangeConnection}
                  disabled={isSavingExchange || !exchangeForm.name.trim() || !hasExchangeExecutionUrl}
                  className="h-8 bg-violet-600 px-3 text-xs font-bold text-white disabled:bg-slate-300"
                >
                  {isSavingExchange ? "Saving" : "Save"}
                </button>
              </div>

              <div className="grid gap-2">

                {isSelectedExchangePolymarket ? (
                  <>
                    <input
                      type="password"
                      autoComplete="off"
                      value={exchangeForm.privateKey}
                      onChange={(event) => updateExchangeForm({ privateKey: event.target.value })}
                      placeholder={
                        selectedExchangeCredentials?.hasPrivateKey
                          ? `Polymarket L1 Private Key saved · ****${selectedExchangeCredentials.privateKeyLast4 || "****"}`
                          : "L1 Private Key"
                      }
                      className="h-9 border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      value={exchangeForm.funder}
                      onChange={(event) => updateExchangeForm({ funder: event.target.value })}
                      placeholder="Funder address, e.g. 0x..."
                      className="h-9 border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                  </>
                ) : (
                  <>
                    <input
                      type="password"
                      autoComplete="off"
                      value={exchangeForm.apiKey}
                      onChange={(event) => updateExchangeForm({ apiKey: event.target.value })}
                      placeholder={
                        selectedExchangeCredentials?.hasApiKey
                          ? `${selectedExchangeName} API Key saved · ****${selectedExchangeCredentials.apiKeyLast4 || "****"}`
                          : "API Key"
                      }
                      className="h-9 border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      type="password"
                      autoComplete="off"
                      value={exchangeForm.apiSecret}
                      onChange={(event) => updateExchangeForm({ apiSecret: event.target.value })}
                      placeholder={
                        selectedExchangeCredentials?.hasApiSecret
                          ? `${selectedExchangeName} Secret saved · enter a new Secret to replace it`
                          : "API Secret"
                      }
                      className="h-9 border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    {isSelectedExchangeOKX ? (
                      <input
                        type="password"
                        autoComplete="off"
                        value={exchangeForm.apiPassphrase}
                        onChange={(event) => updateExchangeForm({ apiPassphrase: event.target.value })}
                        placeholder={
                          selectedExchangeCredentials?.hasApiPassphrase
                            ? "OKX Passphrase saved · enter a new value to replace it"
                            : "API Passphrase"
                        }
                        className="h-9 border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                      />
                    ) : null}
                  </>
                )}
              </div>

              {isSelectedExchangeBinance ? (
                <button
                  type="button"
                  onClick={onTestBinanceAuth}
                  disabled={isTestingExchangeAuth || !canTestBinanceAuth}
                  className="mt-3 inline-flex h-8 items-center border border-amber-300 bg-white px-3 text-xs font-bold text-amber-700 disabled:border-slate-200 disabled:text-slate-400"
                >
                  {isTestingExchangeAuth
                    ? "Syncing"
                    : hasPendingBinanceCredentialInput
                      ? "Save, then Sync Balance"
                      : "Sync Balance"}
                </button>
              ) : null}

              {exchangeFormError ? (
                <div className="mt-2 border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                  {exchangeFormError}
                </div>
              ) : null}

              {exchangeAuthMessage ? (
                <div className="mt-2 border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700">
                  {exchangeAuthMessage}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
