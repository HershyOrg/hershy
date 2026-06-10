import { useEffect, useState } from "react";
import type { DiscussionMessageRow } from "../../../../demoDB";
import { requestVaultDiscussion } from "../api/strategyApi";

export function useVaultDiscussion(vaultAddress: string) {
  const [messages, setMessages] = useState<DiscussionMessageRow[]>([]);
  const [discussionEndpoint, setDiscussionEndpoint] = useState("");
  const [isDiscussionLoading, setIsDiscussionLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setIsDiscussionLoading(true);

    requestVaultDiscussion(vaultAddress)
      .then((response) => {
        if (cancelled) return;
        setMessages(response.messages);
        setDiscussionEndpoint(response.endpoint);
      })
      .finally(() => {
        if (!cancelled) {
          setIsDiscussionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [vaultAddress]);

  const addLocalMessage = (body: string) => {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `local-${Date.now()}`,
        vaultAddress,
        authorName: "You",
        authorAddress: "local-session",
        body,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  return {
    messages,
    discussionEndpoint,
    isDiscussionLoading,
    addLocalMessage,
  };
}
