import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createBailianWebSearchProvider } from "./src/bailian-web-search-provider.js";

export default definePluginEntry({
  id: "bailian",
  name: "Bailian Plugin",
  description: "Bundled Bailian web search plugin",
  register(api) {
    api.registerWebSearchProvider(createBailianWebSearchProvider());
  },
});
