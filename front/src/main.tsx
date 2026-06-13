import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ExternalConsoleNoiseFilter } from "@/shared/components/ExternalConsoleNoiseFilter";
import { ThemeProvider } from "@/shared/components/theme-provider";
import { PrivyAppProvider } from "@/shared/providers/PrivyAppProvider";
import App from "./App";
import "./globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem enableColorScheme>
      <PrivyAppProvider>
        <ExternalConsoleNoiseFilter />
        <App />
      </PrivyAppProvider>
    </ThemeProvider>
  </StrictMode>,
);
