import {
  createWebSearchProviderContractFields,
  mergeScopedSearchConfig,
  resolveProviderWebSearchPluginConfig,
  type WebSearchProviderPlugin,
  type WebSearchProviderToolDefinition,
} from "openclaw/plugin-sdk/provider-web-search-contract";

const BAIDU_CREDENTIAL_PATH = "plugins.entries.baidu.config.webSearch.apiKey";

type BaiduRuntime = typeof import("./baidu-web-search-provider.runtime.js");

let baiduRuntimePromise: Promise<BaiduRuntime> | undefined;

function loadBaiduRuntime(): Promise<BaiduRuntime> {
  baiduRuntimePromise ??= import("./baidu-web-search-provider.runtime.js");
  return baiduRuntimePromise;
}

const BAIDU_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query string." },
    count: {
      type: "number",
      description: "Number of results to request (1-10).",
      minimum: 1,
      maximum: 10,
    },
    country: { type: "string", description: "Not supported by Baidu." },
    language: { type: "string", description: "Not supported by Baidu." },
    freshness: { type: "string", description: "Not supported by Baidu." },
    date_after: { type: "string", description: "Not supported by Baidu." },
    date_before: { type: "string", description: "Not supported by Baidu." },
  },
  required: ["query"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

function createBaiduToolDefinition(
  searchConfig?: Record<string, unknown>,
): WebSearchProviderToolDefinition {
  return {
    description:
      "Search the web using Baidu Web Search. Returns structured titles, URLs, and snippets from Baidu Qianfan web search.",
    parameters: BAIDU_TOOL_PARAMETERS,
    execute: async (args) => {
      const { executeBaiduWebSearch } = await loadBaiduRuntime();
      return await executeBaiduWebSearch(args, searchConfig);
    },
  };
}

export function createBaiduWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "baidu",
    label: "Baidu Web Search",
    hint: "Structured results from Baidu Qianfan web search",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Baidu API key",
    envVars: ["BAIDU_API_KEY"],
    placeholder: "bce-v3/...",
    signupUrl: "https://console.bce.baidu.com/qianfan/ais/console/apiKey",
    docsUrl: "https://docs.openclaw.ai/tools/baidu-search",
    autoDetectOrder: 27,
    credentialPath: BAIDU_CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: BAIDU_CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "baidu" },
      configuredCredential: { pluginId: "baidu" },
      selectionPluginId: "baidu",
    }),
    createTool: (ctx) =>
      createBaiduToolDefinition(
        mergeScopedSearchConfig(
          ctx.searchConfig,
          "baidu",
          resolveProviderWebSearchPluginConfig(ctx.config, "baidu"),
        ),
      ),
  };
}
