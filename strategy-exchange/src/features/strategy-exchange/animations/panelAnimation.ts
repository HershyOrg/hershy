export function getLoadingClassName(baseClassName: string, isLoading: boolean) {
  return `${baseClassName}${isLoading ? " loading" : ""}`;
}

export function getActiveClassName(isActive: boolean) {
  return isActive ? "active" : "";
}
