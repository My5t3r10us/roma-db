import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider } from "./toast";
import { WorkspaceProvider } from "./workspace";
import "./styles.css";
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false },
  },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <ToastProvider>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
