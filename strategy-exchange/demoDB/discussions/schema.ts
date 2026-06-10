export type DiscussionMessageRow = {
  id: string;
  vaultAddress: string;
  authorName: string;
  authorAddress: string;
  body: string;
  createdAt: string;
};

export type VaultDiscussionResponse = {
  endpoint: string;
  sql: string;
  messages: DiscussionMessageRow[];
};
