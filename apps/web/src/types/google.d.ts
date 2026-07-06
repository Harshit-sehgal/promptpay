/**
 * Google Identity Services (GIS) type augmentation.
 *
 * GIS injects `window.google.accounts.id` at runtime from the
 * `https://accounts.google.com/gsi/client` script. This declaration
 * makes TypeScript aware of the API surface used by the login and
 * signup pages without relying on the `@types/google.accounts` npm
 * package (which is maintained by Google and may lag behind their
 * rolling-release JS client).
 *
 * No `declare global` wrapper — `.d.ts` files are ambient declaration
 * files, so any `interface Window { ... }` here automatically augments
 * the global `Window` type.
 */

interface GoogleCredentialResponse {
  credential: string;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize: (config: Record<string, unknown>) => void;
        renderButton: (element: HTMLElement, config: Record<string, unknown>) => void;
        prompt: () => void;
      };
    };
  };
}
