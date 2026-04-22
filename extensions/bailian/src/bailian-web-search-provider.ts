import {
  createWebSearchProviderContractFields,
  mergeScopedSearchConfig,
  resolveProviderWebSearchPluginConfig,
  type WebSearchProviderPlugin,
  type WebSearchProviderSetupContext,
  type WebSearchProviderToolDefinition,
} from "openclaw/plugin-sdk/provider-web-search-contract";

const BAILIAN_CREDENTIAL_PATH = "plugins.entries.bailian.config.webSearch.apiKey";

type BailianRuntime = typeof import("./bailian-web-search-provider.runtime.js");

let bailianRuntimePromise: Promise<BailianRuntime> | undefined;

function loadBailianRuntime(): Promise<BailianRuntime> {
  bailianRuntimePromise ??= import("./bailian-web-search-provider.runtime.js");
  return bailianRuntimePromise;
}

const BAILIAN_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query string." },
    count: {
      type: "number",
      description: "Number of results to request (1-10).",
      minimum: 1,
      maximum: 10,
    },
    country: { type: "string", description: "Not supported by Bailian." },
    language: { type: "string", description: "Not supported by Bailian." },
    freshness: { type: "string", description: "Not supported by Bailian." },
    date_after: { type: "string", description: "Not supported by Bailian." },
    date_before: { type: "string", description: "Not supported by Bailian." },
  },
  required: ["query"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

async function runBailianSearchProviderSetup(
  ctx: WebSearchProviderSetupContext,
): Promise<WebSearchProviderSetupContext["config"]> {
  const runtime = await loadBailianRuntime();
  return await runtime.runBailianSearchProviderSetup(ctx);
}

function createBailianToolDefinition(
  searchConfig?: Record<string, unknown>,
): WebSearchProviderToolDefinition {
  return {
    description:
      "Search the web using Bailian Web Search. Returns AI-synthesized answers with citations by default, or structured search results when Bailian mode is set to results.",
    parameters: BAILIAN_TOOL_PARAMETERS,
    execute: async (args) => {
      const { executeBailianWebSearch } = await loadBailianRuntime();
      return await executeBailianWebSearch(args, searchConfig);
    },
  };
}

export function createBailianWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "bailian",
    label: "Bailian Web Search",
    hint: "Requires Bailian / DashScope API key",
    onboardingScopes: ["text-inference"],
    credentialLabel: "Bailian API key",
    envVars: ["DASHSCOPE_API_KEY", "MODELSTUDIO_API_KEY", "QWEN_API_KEY"],
    placeholder: "sk-...",
    signupUrl: "https://bailian.console.aliyun.com/",
    docsUrl: "https://docs.openclaw.ai/tools/bailian-search",
    autoDetectOrder: 25,
    credentialPath: BAILIAN_CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: BAILIAN_CREDENTIAL_PATH,
      searchCredential: { type: "scoped", scopeId: "bailian" },
      configuredCredential: { pluginId: "bailian" },
      selectionPluginId: "bailian",
    }),
    runSetup: runBailianSearchProviderSetup,
    createTool: (ctx) =>
      createBailianToolDefinition(
        mergeScopedSearchConfig(
          ctx.searchConfig,
          "bailian",
          resolveProviderWebSearchPluginConfig(ctx.config, "bailian"),
        ),
      ),
  };
}
