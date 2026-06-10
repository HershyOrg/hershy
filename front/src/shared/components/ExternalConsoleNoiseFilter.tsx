"use client";

import { useEffect } from "react";

const IGNORED_EXTENSION_ERRORS = [
  "Unable to set window.solana, try uninstalling Phantom.",
];

function shouldIgnoreConsoleError(args: unknown[]) {
  return args.some((arg) => {
    if (typeof arg !== "string") return false;
    return IGNORED_EXTENSION_ERRORS.some((message) => arg.includes(message));
  });
}

export function ExternalConsoleNoiseFilter() {
  useEffect(() => {
    const originalConsoleError = console.error;

    console.error = (...args: unknown[]) => {
      if (shouldIgnoreConsoleError(args)) {
        return;
      }

      originalConsoleError(...args);
    };

    return () => {
      console.error = originalConsoleError;
    };
  }, []);

  return null;
}
