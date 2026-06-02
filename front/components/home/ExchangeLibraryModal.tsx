"use client";

import { type Dispatch, type SetStateAction } from "react";
import { KeyRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeConnection, ExchangeConnectionCredentials, ExchangeFormState } from "./types";

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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <section className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-violet-600">Exchange Setup</div>
            <h2 className="mt-1 text-xl font-black text-slate-950">거래소 연결</h2>
            <p className="mt-1 text-xs text-slate-500">필수 입력만 남겼습니다. 지원 거래소: {exchangeConnectionNames}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)] overflow-hidden">
          <aside className="overflow-auto border-r border-slate-200 bg-slate-50 p-3">
            <div className="grid gap-2">
              {exchangeConnections.map((exchange) => (
                <button
                  key={exchange.id}
                  type="button"
                  onClick={() => onSelectExchange(exchange)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left transition-colors",
                    exchange.id === selectedExchangeId
                      ? "border-violet-300 bg-violet-50"
                      : "border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50",
                  )}
                >
                  <div className="text-sm font-black text-slate-950">{exchange.name}</div>
                  <div className={cn(
                    "mt-1 text-[10px] font-bold",
                    exchange.status === "연결됨" ? "text-emerald-600" : "text-slate-400",
                  )}>
                    {exchange.status}
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <div className="overflow-auto p-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-950">{selectedExchangeName}</div>
                  <div className="mt-0.5 text-[11px] font-semibold text-slate-500">
                    {isSelectedExchangePolymarket
                      ? "필수 입력: L1 Private Key, Funder 주소"
                      : isSelectedExchangeOKX
                        ? "필수 입력: API Key, Secret, Passphrase"
                        : "필수 입력: API Key, Secret"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onSaveExchangeConnection}
                  disabled={isSavingExchange || !exchangeForm.name.trim() || !hasExchangeExecutionUrl}
                  className="h-8 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white disabled:bg-slate-300"
                >
                  {isSavingExchange ? "저장 중" : "저장"}
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
                          ? `Polymarket L1 Private Key 저장됨 · ****${selectedExchangeCredentials.privateKeyLast4 || "****"}`
                          : "L1 Private Key"
                      }
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      value={exchangeForm.funder}
                      onChange={(event) => updateExchangeForm({ funder: event.target.value })}
                      placeholder="Funder 주소 예: 0x..."
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
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
                          ? `${selectedExchangeName} API Key 저장됨 · ****${selectedExchangeCredentials.apiKeyLast4 || "****"}`
                          : "API Key"
                      }
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      type="password"
                      autoComplete="off"
                      value={exchangeForm.apiSecret}
                      onChange={(event) => updateExchangeForm({ apiSecret: event.target.value })}
                      placeholder={
                        selectedExchangeCredentials?.hasApiSecret
                          ? `${selectedExchangeName} Secret 저장됨 · 새 Secret 입력 시 교체`
                          : "API Secret"
                      }
                      className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
                    />
                    {isSelectedExchangeOKX ? (
                      <input
                        type="password"
                        autoComplete="off"
                        value={exchangeForm.apiPassphrase}
                        onChange={(event) => updateExchangeForm({ apiPassphrase: event.target.value })}
                        placeholder={
                          selectedExchangeCredentials?.hasApiPassphrase
                            ? "OKX Passphrase 저장됨 · 새 값 입력 시 교체"
                            : "API Passphrase"
                        }
                        className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-300"
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
                  className="mt-3 inline-flex h-8 items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-700 disabled:border-slate-200 disabled:text-slate-400"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  {isTestingExchangeAuth
                    ? "동기화 중"
                    : hasPendingBinanceCredentialInput
                      ? "저장 후 잔고 동기화"
                      : "잔고 동기화"}
                </button>
              ) : null}

              {exchangeFormError ? (
                <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                  {exchangeFormError}
                </div>
              ) : null}

              {exchangeAuthMessage ? (
                <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700">
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
