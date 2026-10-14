import type { ApiMethods } from "../shared/types";
import { demoCall } from "./demo";
declare global {
  interface Window {
    tiny?: {
      api: { call: (method: string, input?: unknown) => Promise<any> };
      dialog?: { saveFile: (opts?: { types?: string[] }) => Promise<string | null> };
      app?: { shell?: { open: (target: string) => Promise<unknown> } };
    };
  }
}
export const isDesktop = () => Boolean(window.tiny?.api);
export async function call<K extends keyof ApiMethods>(
  method: K,
  input: ApiMethods[K]["input"],
): Promise<ApiMethods[K]["output"]> {
  if (window.tiny?.api) return window.tiny.api.call(method, input);
  return demoCall(method, input) as Promise<ApiMethods[K]["output"]>;
}
