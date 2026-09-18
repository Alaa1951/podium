import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * THE NATIVE SHELL — one Capacitor project per store, pointing at the live
 * site. The app is the website: the shell only draws the icon, the splash and
 * the chrome around a WebView loading podium.bftmiddleeast.com, so a web
 * deploy ships to every install without a store release. Only native-shell
 * changes (plugins, icons, permissions) need a new store build.
 *
 * The bundle under capacitor-web/ exists for the two moments the remote site
 * is not what is on screen: the instant before the first navigation completes
 * (index.html hands straight over) and when the WebView errors out
 * (offline.html — the shell's own offline card, since the site's service
 * worker does not run inside a store WebView).
 */
const config: CapacitorConfig = {
  appId: "app.podium.bftmena",
  appName: "PODIUM",
  webDir: "capacitor-web",
  ios: { contentInset: "never" },
  plugins: {
    // Capacitor 8 SystemBars owns Android's window/IME insets. Enabling the
    // older Keyboard full-screen workaround as well resizes the window twice.
    Keyboard: { resize: KeyboardResize.Native },
    SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover" },
  },
  server: {
    // The store shells open on the sign-in screen: every store user is staff
    // or a competitor with an account, and the public board stays on the web.
    url: "https://podium.bftmiddleeast.com/login",
    // A rotated host or www redirect must not kick the user out to a browser.
    allowNavigation: ["podium.bftmiddleeast.com", "*.bftmiddleeast.com"],
    cleartext: false,
    errorPath: "offline.html",
  },
};

export default config;
