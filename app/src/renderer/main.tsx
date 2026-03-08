import "@fontsource/geist-mono";
import "@fontsource/geist-sans";
import { ThemeProvider } from "@/shell/components/theme-provider";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
      storageKey="vite-ui-theme"
    >
      <App />
    </ThemeProvider>
  </StrictMode>,
);
