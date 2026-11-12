import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

/* Capture the install prompt as early as possible (it can fire before React mounts). */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  (window as unknown as { __capInstallPrompt?: Event }).__capInstallPrompt = e;
  window.dispatchEvent(new Event("cap-install-ready"));
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/* Register the service worker (production, secure contexts only). */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is progressive enhancement — never block the app */
    });
  });
}
