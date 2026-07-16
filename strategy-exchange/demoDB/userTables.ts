export type UserAccountRow = {
  creatorId: string;
  eoaAddress: string;
  avatarUrl?: string;
  aliases: string[];
  joinedAt: string;
  socialLinks: {
    twitter?: string;
    github?: string;
  };
};

export const userAccountsTable: UserAccountRow[] = [
  {
    creatorId: "quant.kim",
    eoaAddress: "0xc93c835eec0bc130f9c78d6debe6b6b8393806c0",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=quant.kim&backgroundColor=d0ad4f",
    aliases: ["0x7C2F...A19F"],
    joinedAt: "2026-02-14T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/quant_kim",
      github: "https://github.com/quant-kim",
    },
  },
  {
    creatorId: "nari.trade",
    eoaAddress: "0x751c7566baf4fec0be6edf0d479b5bf73a68918f",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=nari.trade&backgroundColor=8da9c9",
    aliases: ["0x42B8...2E1C"],
    joinedAt: "2026-02-18T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/nari_trade",
      github: "https://github.com/nari-trade",
    },
  },
  {
    creatorId: "slotmaker",
    eoaAddress: "0x1cada472cf3d2161e44535f054d12904822e15e7",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=slotmaker&backgroundColor=23b56e",
    aliases: ["0x9Da3...7710"],
    joinedAt: "2026-03-01T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/slotmaker",
      github: "https://github.com/slotmaker",
    },
  },
  {
    creatorId: "mira.exec",
    eoaAddress: "0x5668ddaacb72dcb427639d114783930275e11e12",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=mira.exec&backgroundColor=d95757",
    aliases: [],
    joinedAt: "2026-03-04T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/mira_exec",
      github: "https://github.com/mira-exec",
    },
  },
  {
    creatorId: "yuna.delta",
    eoaAddress: "0xf193654d16897301c3bc245e03d0635e540b35f7",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=yuna.delta&backgroundColor=a695d8",
    aliases: ["0x1162...E0d9"],
    joinedAt: "2026-03-12T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/yuna_delta",
      github: "https://github.com/yuna-delta",
    },
  },
  {
    creatorId: "juno.core",
    eoaAddress: "0xbddf37ba0ef5943d365243b4a83ed08e0816c3a5",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=juno.core&backgroundColor=c9a956",
    aliases: ["0x0B17...C3AA"],
    joinedAt: "2026-03-19T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/juno_core",
      github: "https://github.com/juno-core",
    },
  },
  {
    creatorId: "seoulbot",
    eoaAddress: "0x6b8dc2e09a7f1352b402a4600a76063a1108b1d3",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=seoulbot&backgroundColor=7dd3fc",
    aliases: [],
    joinedAt: "2026-03-24T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/seoulbot",
      github: "https://github.com/seoulbot",
    },
  },
  {
    creatorId: "dawnlabs",
    eoaAddress: "0xd7f7f4eeb2e96f0138568eab46f26a9db24d798b",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=dawnlabs&backgroundColor=f0abfc",
    aliases: ["0x6335...019B"],
    joinedAt: "2026-04-02T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/dawnlabs",
      github: "https://github.com/dawnlabs",
    },
  },
  {
    creatorId: "alex.macro",
    eoaAddress: "0x96afafab3fc17f3c9866db4f274c2392b4116981",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=alex.macro&backgroundColor=fda4af",
    aliases: [],
    joinedAt: "2026-04-10T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/alex_macro",
      github: "https://github.com/alex-macro",
    },
  },
  {
    creatorId: "chainpilot",
    eoaAddress: "0x08c686c8e28159cff62acb3bc45f7d323dd799d2",
    avatarUrl: "https://api.dicebear.com/9.x/personas/svg?seed=chainpilot&backgroundColor=93c5fd",
    aliases: ["0xaF55...8172"],
    joinedAt: "2026-04-18T00:00:00.000Z",
    socialLinks: {
      twitter: "https://x.com/chainpilot",
      github: "https://github.com/chainpilot",
    },
  },
];
