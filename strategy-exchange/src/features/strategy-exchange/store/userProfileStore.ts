import type { UserAccountRow } from "../../../../demoDB";
import type { Creator, UserProfileDraft, UserProfileView } from "../types/strategyTypes";

const userProfileKey = "strategy-exchange-user-profiles";

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(key);
  return saved ? (JSON.parse(saved) as T) : null;
}

function writeProfiles(profiles: Record<string, UserProfileView>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(userProfileKey, JSON.stringify(profiles));
}

export function readUserProfileOverrides() {
  return readJson<Record<string, UserProfileView>>(userProfileKey) ?? {};
}

export function readUserProfileOverride(creatorId: string) {
  return readUserProfileOverrides()[creatorId] ?? null;
}

export function buildUserProfile(creator: Creator, account: UserAccountRow): UserProfileView {
  const override = readUserProfileOverride(account.creatorId);

  return {
    creatorId: account.creatorId,
    name: override?.name ?? creator.name,
    handle: override?.handle ?? creator.handle,
    bio: override?.bio ?? creator.bio,
    avatarUrl: override?.avatarUrl ?? account.avatarUrl ?? "",
    twitter: override?.twitter ?? account.socialLinks.twitter ?? "",
    github: override?.github ?? account.socialLinks.github ?? "",
    exchanges: override?.exchanges ?? creator.exchanges,
    chains: override?.chains ?? creator.chains,
    updatedAt: override?.updatedAt,
  };
}

export function updateUserProfile(creatorId: string, draft: UserProfileDraft) {
  const now = new Date().toISOString();
  const profile: UserProfileView = {
    creatorId,
    name: draft.name.trim(),
    handle: draft.handle.trim(),
    bio: draft.bio.trim(),
    avatarUrl: draft.avatarUrl.trim(),
    twitter: draft.twitter.trim(),
    github: draft.github.trim(),
    exchanges: draft.exchanges,
    chains: draft.chains,
    updatedAt: now,
  };
  const profiles = readUserProfileOverrides();
  writeProfiles({
    ...profiles,
    [creatorId]: profile,
  });
  return profile;
}
