import "@fontsource-variable/inter";
import { Buffer } from "buffer";
import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";
import "./studio-shell.css";

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

createApp(App).mount("#app");
