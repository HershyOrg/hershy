export type DiscussionMessageRow = {
  id: string;
  adapterAddress: string;
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
