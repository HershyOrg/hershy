import { FormEvent, useState } from "react";
import { SUGGESTED_PROMPTS } from "@/features/ai-wallet/mock-data/wallet";
import type { ChatMessage, GeneratedPlan } from "@/features/ai-wallet/types/walletTypes";
import { formatTime } from "@/features/ai-wallet/utils/formatters";
import { Bot, CheckCircle2, Clock, Send, Sparkles, UserCircle } from "@/shared/components/icons";
import { cn } from "@/shared/utils/utils";

type ChatPanelProps = {
  messages: ChatMessage[];
  activePlan: GeneratedPlan | null;
  isGenerating: boolean;
  onSubmitPrompt: (prompt: string) => void;
  onSelectPlan: () => void;
};

export function ChatPanel({
  messages,
  activePlan,
  isGenerating,
  onSubmitPrompt,
  onSelectPlan,
}: ChatPanelProps) {
  const [prompt, setPrompt] = useState("");

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || isGenerating) return;
    setPrompt("");
    onSubmitPrompt(trimmedPrompt);
  }

  return (
    <section className="panel chat-panel" aria-label="Chat">
      <div className="panel__header">
        <div>
          <p className="panel__eyebrow">Assistant</p>
          <h2>실행 요청</h2>
        </div>
        <div className={cn("status-chip", isGenerating && "status-chip--loading")}>
          {isGenerating ? <Clock size={14} /> : <CheckCircle2 size={14} />}
          <span>{isGenerating ? "생성 중" : "준비됨"}</span>
        </div>
      </div>

      <div className="chat-thread">
        {messages.map((message) => {
          const Icon = message.role === "user" ? UserCircle : Bot;

          return (
            <article className={cn("chat-message", `chat-message--${message.role}`)} key={message.id}>
              <div className="chat-message__avatar">
                <Icon size={18} />
              </div>
              <div className="chat-message__bubble">
                <div className="chat-message__meta">
                  <span>{message.role === "user" ? "You" : message.role === "system" ? "Session" : "Hershy"}</span>
                  <span>{formatTime(message.timestamp)}</span>
                </div>
                <p>{message.content}</p>
                {message.planId && activePlan?.id === message.planId ? (
                  <button type="button" className="inline-plan-button" onClick={onSelectPlan}>
                    <Sparkles size={15} />
                    <span>그래프 확인</span>
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="prompt-strip" aria-label="Suggested prompts">
        {SUGGESTED_PROMPTS.map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => {
              setPrompt(item);
            }}
          >
            {item}
          </button>
        ))}
      </div>

      <form className="chat-composer" onSubmit={submitPrompt}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="예: 내 USDC 500개를 WETH로 바꿔줘"
          rows={2}
        />
        <button type="submit" className="send-button" disabled={!prompt.trim() || isGenerating} title="전송">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}
