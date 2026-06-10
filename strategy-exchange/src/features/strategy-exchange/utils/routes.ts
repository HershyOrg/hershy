import {
  selectUserAccountByAddress,
  selectUserAccountByCreatorId,
  selectVaultByAddress,
} from "../../../../demoDB";
import type { AddressRoute } from "../types/strategyTypes";

export const launchLogicPath = "/launch-logic";
const legacyCreateLogicPath = "/create-logic";
export const myPagePath = "/me";
export const myPageEditPath = "/me/edit";

export function isLaunchLogicPath() {
  if (typeof window === "undefined") return false;
  if (window.location.pathname === legacyCreateLogicPath) {
    window.history.replaceState("", document.title, launchLogicPath);
    return true;
  }
  return window.location.pathname === launchLogicPath;
}

export function isMyPagePath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === myPagePath;
}

export function isMyPageEditPath() {
  if (typeof window === "undefined") return false;
  return window.location.pathname === myPageEditPath;
}

export function getCreatorHashValue() {
  if (typeof window === "undefined") return null;
  const prefix = "#creator/";
  if (!window.location.hash.startsWith(prefix)) return null;
  return decodeURIComponent(window.location.hash.slice(prefix.length));
}

export function getCreatorAddressFromHash() {
  const value = getCreatorHashValue();
  if (!value) return null;
  return selectUserAccountByCreatorId(value)?.eoaAddress ?? value;
}

export function normalizeCreatorHashUrl() {
  const value = getCreatorHashValue();
  if (!value) return;
  const legacyAccount = selectUserAccountByCreatorId(value);
  if (!legacyAccount) return;
  window.history.replaceState("", document.title, `/${encodeURIComponent(legacyAccount.eoaAddress)}`);
}

export function getVaultAddressFromHash() {
  if (typeof window === "undefined") return null;
  const prefix = "#vault/";
  if (!window.location.hash.startsWith(prefix)) return null;
  return decodeURIComponent(window.location.hash.slice(prefix.length));
}

export function getAddressFromLegacyHash() {
  return getCreatorAddressFromHash() ?? getVaultAddressFromHash();
}

export function migrateLegacyHashRouteToPath() {
  if (typeof window === "undefined") return null;
  const address = getAddressFromLegacyHash();
  if (!address) return null;
  window.history.replaceState("", document.title, `/${encodeURIComponent(address)}`);
  return address;
}

export function getAddressFromPath() {
  if (typeof window === "undefined") return null;
  const [segment] = window.location.pathname.split("/").filter(Boolean);
  if (!segment || segment === "api" || segment === "create-logic" || segment === "launch-logic" || segment === "me") return null;
  return decodeURIComponent(segment);
}

export function resolveAddressRouteFromAddress(address: string): AddressRoute {
  const vault = selectVaultByAddress(address);
  if (vault) {
    return {
      kind: "vault",
      address,
      strategyId: vault.strategyId,
    };
  }

  const account = selectUserAccountByAddress(address);
  if (account) {
    return {
      kind: "user",
      address,
      account,
    };
  }

  return {
    kind: "unknown",
    address,
  };
}

export function getAddressRouteFromLocation() {
  const address = getAddressFromPath() ?? migrateLegacyHashRouteToPath();
  return address ? resolveAddressRouteFromAddress(address) : null;
}
