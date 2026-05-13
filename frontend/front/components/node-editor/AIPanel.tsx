import React, { useState, useRef, useEffect } from "react";
import { Send, Bot, Sparkles, Loader2, Maximize2, Minimize2 } from "lucide-react";

type ChatMessage = {
  role: "user" | "ai";
  text: string;
  component?: React.ReactNode;
};

export const AIPanel = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "ai",
      text: "안녕하세요. 트레이딩 전략 자동 생성 매니저입니다. 어떤 전략을 만들고 싶으신가요?",
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const appendMessage = (msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!prompt.trim() || isLoading) return;

    const submittedPrompt = prompt.trim();
    appendMessage({ role: "user", text: submittedPrompt });
    setPrompt("");
    setIsLoading(true);

    try {
      const response = await fetch('/api/ai/strategy-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: submittedPrompt })
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(String(data?.message || data?.error || `서버 요청 실패 (상태 코드: ${response.status})`));
      }
      
      const { strategy, message, research } = data;
      
      if (!strategy || !strategy.blocks) {
         throw new Error("올바르지 않은 전략 데이터입니다.");
      }

      appendMessage({
        role: "ai",
        text: message || `전략 생성이 완료되었습니다: ${strategy.strategy?.name || '새로운 전략'}`,
      });

      // API의 blocks/connections를 노드와 엣지로 변환하여 에디터에 주입
      const nodes = (strategy.blocks || []).map((block: any) => {
        let nodeType = "functionNode";
        if (block.type === "streaming") nodeType = "monitoringNode";
        if (block.type === "trigger") nodeType = "timeTrigger";
        if (block.type === "action") nodeType = "actionNode";
        if (block.type === "monitoring") nodeType = "monitoringNode";

        return {
          id: block.id,
          type: nodeType,
          position: { x: 0, y: 0 },
          data: {
            label: block.config?.name || block.id,
            ...block.config
          }
        }
      });

      const edges = (strategy.connections || []).map((conn: any, i: number) => ({
        id: conn.id || `edge-${i}`,
        source: conn.fromId,
        target: conn.toId,
        animated: true,
      }));

      // 실제 데이터를 노드 에디터에 주입하는 이벤트 발생
      window.dispatchEvent(new CustomEvent("injectAINodes", { 
        detail: { nodes, edges } 
      }));

    } catch (err: any) {
      const message = String(err?.message || "알 수 없는 오류");
      const hint = /timeout|timed out|aborted/i.test(message)
        ? "\n서버의 DEEPSEEK_TIMEOUT_SEC 또는 AI_STRATEGY_DEEPSEEK_TIMEOUT_SEC 값을 늘린 뒤 다시 시도하세요."
        : "";
      appendMessage({
        role: "ai",
        text: `오류가 발생했습니다: ${message}${hint}`,
      });
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={`fixed right-0 z-50 flex flex-col bg-background/80 backdrop-blur-xl border-l shadow-2xl transition-all duration-500 ease-in-out text-slate-100 font-sans ${
        isExpanded ? "top-14 bottom-0 w-[800px]" : "top-20 bottom-8 w-[400px] rounded-l-2xl border-y"
      }`}
      style={{
        boxShadow: isExpanded
          ? "-10px 0 30px -10px rgba(0,0,0,0.5)"
          : "-5px 5px 20px -5px rgba(0,0,0,0.4)",
      }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-wide">AI 전략 생성 콜라보레이터</h3>
            <p className="text-[10px] text-muted-foreground uppercase opacity-80 pt-0.5">Real Agent Loop</p>
          </div>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2 transition-colors rounded-md text-muted-foreground hover:text-foreground hover:bg-slate-800"
          title={isExpanded ? "기본 크기로 복귀" : "전체화면으로 확장"}
        >
          {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex-1 p-5 overflow-y-auto text-sm space-y-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {messages.map((msg, index) => (
          <div key={index} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {msg.role === "ai" && (
              <div className="flex items-center justify-center flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 text-primary border border-slate-700">
                <Bot className="w-4 h-4" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-slate-800/80 text-slate-200 border border-slate-700/50 rounded-tl-sm leading-relaxed"
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.text}</div>
              {msg.component && <div className="mt-3">{msg.component}</div>}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex items-center justify-center flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 text-primary border border-slate-700">
              <Bot className="w-4 h-4" />
            </div>
            <div className="rounded-2xl px-5 py-3.5 bg-slate-800/80 text-slate-200 border border-slate-700/50 rounded-tl-sm flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">전략 생성 중...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-border/40 bg-muted/20">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="relative max-w-4xl mx-auto"
        >
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="만들고 싶은 전략을 얘기해주세요..."
            className="w-full py-4 pl-5 pr-14 bg-slate-900 border border-slate-700 rounded-xl resize-none focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm transition-all placeholder:text-muted-foreground shadow-inner text-slate-100 min-h-[60px] max-h-[200px]"
            rows={1}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!prompt.trim() || isLoading}
            className="absolute p-2 transition-all rounded-lg right-3 top-3 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-md"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
