import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk/provider-onboard";
import {
  buildSearchCacheKey,
  buildUnsupportedSearchFilterResponse,
  DEFAULT_SEARCH_COUNT,
  mergeScopedSearchConfig,
  readCachedSearchPayload,
  readConfiguredSecretString,
  readNumberParam,
  readProviderEnvValue,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchCacheTtlMs,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  setProviderWebSearchPluginConfigValue,
  type SearchConfigRecord,
  type WebSearchProviderSetupContext,
  withTrustedWebSearchEndpoint,
  wrapWebContent,
  writeCachedSearchPayload,
} from "openclaw/plugin-sdk/provider-web-search";

const BAILIAN_MCP_URL = "https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp";
const BAILIAN_MCP_TOOL_NAME = "bailian_web_search";
const BAILIAN_DEFAULT_MODE = "answer";

type BailianMode = "answer" | "results";

type BailianConfig = {
  apiKey?: unknown;
  mode?: unknown;
};

type BailianSearchResult = {
  title: string;
  url?: string;
  snippet?: string;
};

type BailianParsedPayload = {
  answer?: string;
  citations: string[];
  results: BailianSearchResult[];
};

type BailianInitializeProbeResult =
  | {
      kind: "http";
      ok: boolean;
      status: number;
      statusText?: string;
      contentType?: string;
      bodyPreview?: string;
    }
  | {
      kind: "error";
      error: string;
    };

type BailianJsonRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

type BailianJsonRpcEnvelope = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: BailianJsonRpcError;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function maybeParseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function resolveBailianConfig(searchConfig?: SearchConfigRecord): BailianConfig {
  const bailian = searchConfig?.bailian;
  return isRecord(bailian) ? (bailian as BailianConfig) : {};
}

function resolveBailianMode(config?: BailianConfig): BailianMode {
  return normalizeString(config?.mode)?.toLowerCase() === "results" ? "results" : "answer";
}

function resolveBailianApiKey(config?: BailianConfig): string | undefined {
  return (
    readConfiguredSecretString(config?.apiKey, "tools.web.search.bailian.apiKey") ??
    readProviderEnvValue(["DASHSCOPE_API_KEY", "MODELSTUDIO_API_KEY", "QWEN_API_KEY"])
  );
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeString(error.message) ?? error.name;
  }
  return normalizeString(String(error)) ?? "Unknown error";
}

function extractUrl(value: unknown): string | undefined {
  const url = normalizeString(value);
  if (!url) {
    return undefined;
  }
  return /^https?:\/\//iu.test(url) ? url : undefined;
}

function normalizeBailianResultTitle(value: unknown): string | undefined {
  const title = normalizeString(value);
  if (!title) {
    return undefined;
  }
  return title.toLowerCase() === "null" ? undefined : title;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function extractSnippet(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = normalizeString(value);
    return normalized ? compactWhitespace(normalized) : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => normalizeString(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? compactWhitespace(parts.join(" ")) : undefined;
  }
  return undefined;
}

function maybeCollectSearchResult(value: unknown): BailianSearchResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const url = extractUrl(value.url ?? value.link ?? value.uri ?? value.href ?? value.source_url);
  const explicitTitle =
    normalizeBailianResultTitle(value.title) ??
    normalizeString(value.name) ??
    normalizeString(value.headline) ??
    undefined;
  const snippet =
    extractSnippet(value.snippet) ??
    extractSnippet(value.snippets) ??
    extractSnippet(value.summary) ??
    extractSnippet(value.description) ??
    extractSnippet(value.content) ??
    extractSnippet(value.text);

  if (!url && !explicitTitle && !snippet) {
    return undefined;
  }
  if (!snippet && !(url && explicitTitle)) {
    return undefined;
  }

  return {
    title: explicitTitle ?? url ?? "Bailian result",
    ...(url ? { url } : {}),
    ...(snippet ? { snippet } : {}),
  };
}

function collectPayloadRoots(result: CallToolResult): unknown[] {
  const roots: unknown[] = [];

  if ("structuredContent" in result && result.structuredContent !== undefined) {
    roots.push(result.structuredContent);
  }

  for (const entry of result.content ?? []) {
    if (isRecord(entry)) {
      if ("text" in entry && entry.text !== undefined) {
        roots.push(maybeParseJsonString(entry.text));
      }
      if ("data" in entry && entry.data !== undefined) {
        roots.push(entry.data);
      }
      if ("json" in entry && entry.json !== undefined) {
        roots.push(entry.json);
      }
      if ("content" in entry && entry.content !== undefined) {
        roots.push(entry.content);
      }
    } else {
      roots.push(entry);
    }
  }

  return roots;
}

function collectTextCandidates(
  value: unknown,
  sink: Set<string>,
  visited = new Set<object>(),
  allowPlainStrings = true,
): void {
  if (typeof value === "string") {
    if (allowPlainStrings) {
      const text = normalizeString(value);
      if (text) {
        sink.add(text);
      }
    }
    return;
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    return;
  }
  if (typeof value === "object" && value !== null) {
    if (visited.has(value)) {
      return;
    }
    visited.add(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTextCandidates(entry, sink, visited, false);
    }
    return;
  }

  const preferredKeys = ["answer", "summary", "text", "content", "message", "result"];
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (typeof candidate === "string") {
      const text = normalizeString(candidate);
      if (text) {
        sink.add(text);
      }
    } else if (Array.isArray(candidate)) {
      const snippet = extractSnippet(candidate);
      if (snippet) {
        sink.add(snippet);
      }
    }
  }

  for (const entry of Object.values(value)) {
    collectTextCandidates(entry, sink, visited, false);
  }
}

function collectSearchResults(
  value: unknown,
  sink: BailianSearchResult[],
  visited = new Set<object>(),
): void {
  if (!isRecord(value) && !Array.isArray(value)) {
    return;
  }
  if (typeof value === "object" && value !== null) {
    if (visited.has(value)) {
      return;
    }
    visited.add(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSearchResults(entry, sink, visited);
    }
    return;
  }

  const result = maybeCollectSearchResult(value);
  if (result) {
    sink.push(result);
  }

  for (const entry of Object.values(value)) {
    collectSearchResults(entry, sink, visited);
  }
}

function collectCitationTargets(
  value: unknown,
  sink: Set<string>,
  visited = new Set<object>(),
): void {
  const directUrl = extractUrl(value);
  if (directUrl) {
    sink.add(directUrl);
    return;
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    return;
  }
  if (typeof value === "object" && value !== null) {
    if (visited.has(value)) {
      return;
    }
    visited.add(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectCitationTargets(entry, sink, visited);
    }
    return;
  }

  const candidateUrl = extractUrl(value.url ?? value.link ?? value.href ?? value.uri);
  if (candidateUrl) {
    sink.add(candidateUrl);
  }
}

function collectExplicitCitations(
  value: unknown,
  sink: Set<string>,
  visited = new Set<object>(),
): void {
  if (!isRecord(value) && !Array.isArray(value)) {
    return;
  }
  if (typeof value === "object" && value !== null) {
    if (visited.has(value)) {
      return;
    }
    visited.add(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectExplicitCitations(entry, sink, visited);
    }
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "citations" ||
      normalizedKey === "citation" ||
      normalizedKey === "references" ||
      normalizedKey === "reference" ||
      normalizedKey === "sources" ||
      normalizedKey === "source" ||
      normalizedKey === "links" ||
      normalizedKey === "urls"
    ) {
      collectCitationTargets(entry, sink);
      continue;
    }
    collectExplicitCitations(entry, sink, visited);
  }
}

function dedupeResults(results: BailianSearchResult[]): BailianSearchResult[] {
  const deduped = new Map<string, BailianSearchResult>();
  for (const result of results) {
    const key = `${result.url ?? ""}\u0000${result.title}\u0000${result.snippet ?? ""}`;
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  }
  return [...deduped.values()];
}

function deriveAnswerFromResults(results: BailianSearchResult[]): string | undefined {
  const summaryEntries = results
    .map((result) => {
      const title =
        normalizeBailianResultTitle(result.title) &&
        result.title !== result.url &&
        result.title !== "Bailian result"
          ? compactWhitespace(result.title)
          : undefined;
      const snippet = result.snippet
        ? truncateText(compactWhitespace(result.snippet), 240)
        : undefined;
      return { title, snippet, url: result.url };
    })
    .filter((entry) => entry.title || entry.snippet || entry.url)
    .slice(0, 3);

  if (summaryEntries.length === 0) {
    return undefined;
  }

  if (summaryEntries.length === 1) {
    return summaryEntries[0].snippet ?? summaryEntries[0].title ?? summaryEntries[0].url;
  }

  const lines = summaryEntries.map((entry, index) => {
    if (entry.title && entry.snippet) {
      return `${index + 1}. ${entry.title}: ${entry.snippet}`;
    }
    return `${index + 1}. ${entry.snippet ?? entry.title ?? entry.url}`;
  });
  return truncateText(lines.join("\n\n"), 900);
}

function parseBailianCallToolResult(result: CallToolResult): BailianParsedPayload {
  const roots = collectPayloadRoots(result);
  const answerCandidates = new Set<string>();
  const citations = new Set<string>();
  const results: BailianSearchResult[] = [];

  for (const root of roots) {
    collectTextCandidates(root, answerCandidates);
    collectSearchResults(root, results);
    collectExplicitCitations(root, citations);
  }

  const dedupedResults = dedupeResults(results);
  for (const resultEntry of dedupedResults) {
    if (resultEntry.url) {
      citations.add(resultEntry.url);
    }
  }

  const sortedAnswerCandidates = [...answerCandidates].toSorted(
    (left, right) => right.length - left.length,
  );
  const answer = sortedAnswerCandidates[0] ?? deriveAnswerFromResults(dedupedResults);

  return {
    ...(answer ? { answer } : {}),
    citations: [...citations],
    results: dedupedResults,
  };
}

function formatBailianRpcError(label: string, error: BailianJsonRpcError): Error {
  const code = typeof error.code === "number" ? error.code : undefined;
  const message = normalizeString(error.message) ?? "unknown error";
  const detail = code == null ? message : `${message} (code ${code})`;
  return new Error(`Bailian ${label} failed: ${detail}`);
}

async function readJsonResponse(
  response: Response,
  label: string,
): Promise<{ status: number; data?: unknown }> {
  if (!response.ok) {
    const detail = await readResponsePreview(response, 2_000);
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`Bailian ${label} failed with HTTP ${response.status}${suffix}`);
  }

  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    return { status: response.status };
  }

  try {
    return {
      status: response.status,
      data: JSON.parse(trimmed) as unknown,
    };
  } catch (error) {
    throw new Error(`Bailian ${label} returned invalid JSON: ${formatErrorMessage(error)}`, {
      cause: error,
    });
  }
}

function unwrapBailianJsonRpcResult(label: string, data: unknown): unknown {
  if (!isRecord(data)) {
    throw new Error(`Bailian ${label} returned an invalid JSON-RPC envelope.`);
  }

  const envelope = data as BailianJsonRpcEnvelope;
  if (envelope.error) {
    throw formatBailianRpcError(label, envelope.error);
  }

  if (!("result" in envelope)) {
    throw new Error(`Bailian ${label} JSON-RPC response is missing result.`);
  }

  return envelope.result;
}

async function sendBailianJsonRpcRequest(params: {
  apiKey: string;
  timeoutSeconds: number;
  label: string;
  body: Record<string, unknown>;
}): Promise<{ status: number; data?: unknown }> {
  return await withTrustedWebSearchEndpoint(
    {
      url: BAILIAN_MCP_URL,
      timeoutSeconds: params.timeoutSeconds,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params.body),
      },
    },
    async (response) => await readJsonResponse(response, params.label),
  );
}

async function readResponsePreview(
  response: Response,
  maxChars = 500,
): Promise<string | undefined> {
  try {
    const text = normalizeString(await response.text());
    if (!text) {
      return undefined;
    }
    return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
  } catch {
    return undefined;
  }
}

async function probeBailianInitialize(params: {
  apiKey: string;
  timeoutMs: number;
}): Promise<BailianInitializeProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await fetch(BAILIAN_MCP_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "openclaw-bailian-web-search-probe",
            version: "0.0.0",
          },
        },
      }),
      signal: controller.signal,
    });
    const bodyPreview = await readResponsePreview(response);
    return {
      kind: "http",
      ok: response.ok,
      status: response.status,
      ...(normalizeString(response.statusText) ? { statusText: response.statusText } : {}),
      ...(normalizeString(response.headers.get("content-type") ?? "")
        ? { contentType: response.headers.get("content-type") ?? undefined }
        : {}),
      ...(bodyPreview ? { bodyPreview } : {}),
    };
  } catch (error) {
    return {
      kind: "error",
      error: formatErrorMessage(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildBailianMcpDiagnosticError(
  error: unknown,
  probeResult: BailianInitializeProbeResult,
): Error {
  const message = formatErrorMessage(error);
  if (probeResult.kind === "error") {
    return new Error(
      `${message}. Bailian MCP initialize probe failed before search: ${probeResult.error}.`,
    );
  }

  const statusSuffix = probeResult.statusText ? ` ${probeResult.statusText}` : "";
  const contentTypeSuffix = probeResult.contentType ? ` (${probeResult.contentType})` : "";
  const bodySuffix = probeResult.bodyPreview ? ` Body: ${probeResult.bodyPreview}` : "";
  return new Error(
    `${message}. Bailian MCP initialize probe returned HTTP ${probeResult.status}${statusSuffix}${contentTypeSuffix}.${bodySuffix}`,
  );
}

async function runBailianMcpSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
}): Promise<CallToolResult> {
  try {
    unwrapBailianJsonRpcResult(
      "initialize",
      (
        await sendBailianJsonRpcRequest({
          apiKey: params.apiKey,
          timeoutSeconds: params.timeoutSeconds,
          label: "initialize",
          body: {
            jsonrpc: "2.0",
            id: 0,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: {
                name: "openclaw-bailian-web-search",
                version: "0.0.0",
              },
            },
          },
        })
      ).data,
    );

    await sendBailianJsonRpcRequest({
      apiKey: params.apiKey,
      timeoutSeconds: params.timeoutSeconds,
      label: "notifications/initialized",
      body: {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
    });

    const toolsResult = unwrapBailianJsonRpcResult(
      "tools/list",
      (
        await sendBailianJsonRpcRequest({
          apiKey: params.apiKey,
          timeoutSeconds: params.timeoutSeconds,
          label: "tools/list",
          body: {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
          },
        })
      ).data,
    );
    const tools =
      isRecord(toolsResult) && Array.isArray(toolsResult.tools) ? toolsResult.tools : [];
    if (
      tools.length > 0 &&
      !tools.some((tool) => isRecord(tool) && normalizeString(tool.name) === BAILIAN_MCP_TOOL_NAME)
    ) {
      throw new Error(`Bailian tools/list did not advertise ${BAILIAN_MCP_TOOL_NAME}.`);
    }

    return unwrapBailianJsonRpcResult(
      "tools/call",
      (
        await sendBailianJsonRpcRequest({
          apiKey: params.apiKey,
          timeoutSeconds: params.timeoutSeconds,
          label: "tools/call",
          body: {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: BAILIAN_MCP_TOOL_NAME,
              arguments: {
                query: params.query,
                count: params.count,
              },
            },
          },
        })
      ).data,
    ) as CallToolResult;
  } catch (error) {
    const probeResult = await probeBailianInitialize({
      apiKey: params.apiKey,
      timeoutMs: Math.min(Math.max(1000, params.timeoutSeconds * 1000), 15_000),
    });
    throw buildBailianMcpDiagnosticError(error, probeResult);
  }
}

export async function executeBailianWebSearch(
  args: Record<string, unknown>,
  searchConfig?: SearchConfigRecord,
): Promise<Record<string, unknown>> {
  const unsupportedResponse = buildUnsupportedSearchFilterResponse(args, "bailian");
  if (unsupportedResponse) {
    return unsupportedResponse;
  }

  const bailianConfig = resolveBailianConfig(searchConfig);
  const apiKey = resolveBailianApiKey(bailianConfig);
  if (!apiKey) {
    return {
      error: "missing_bailian_api_key",
      message:
        "web_search (bailian) needs an API key. Set DASHSCOPE_API_KEY, MODELSTUDIO_API_KEY, or QWEN_API_KEY in the Gateway environment, or configure plugins.entries.bailian.config.webSearch.apiKey.",
      docs: "https://docs.openclaw.ai/tools/bailian-search",
    };
  }

  const query = readStringParam(args, "query", { required: true });
  const count =
    readNumberParam(args, "count", { integer: true }) ?? searchConfig?.maxResults ?? undefined;
  const resolvedCount = resolveSearchCount(count, DEFAULT_SEARCH_COUNT);
  const mode = resolveBailianMode(bailianConfig);
  const cacheKey = buildSearchCacheKey(["bailian", query, resolvedCount, mode]);
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) {
    return cached;
  }

  const start = Date.now();
  const parsed = parseBailianCallToolResult(
    await runBailianMcpSearch({
      query,
      count: resolvedCount,
      apiKey,
      timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
    }),
  );
  const externalContent = {
    untrusted: true,
    source: "web_search",
    provider: "bailian",
    wrapped: true,
  } as const;

  const payload =
    mode === "results"
      ? {
          query,
          provider: "bailian",
          mode,
          count: parsed.results.length || (parsed.answer ? 1 : 0),
          tookMs: Date.now() - start,
          externalContent,
          results:
            parsed.results.length > 0
              ? parsed.results.map((result) => ({
                  title: wrapWebContent(result.title, "web_search"),
                  ...(result.url ? { url: result.url } : {}),
                  ...(result.snippet
                    ? { snippet: wrapWebContent(result.snippet, "web_search") }
                    : {}),
                }))
              : parsed.answer
                ? [
                    {
                      title: wrapWebContent("Bailian answer", "web_search"),
                      snippet: wrapWebContent(parsed.answer, "web_search"),
                    },
                  ]
                : [],
        }
      : {
          query,
          provider: "bailian",
          mode,
          tookMs: Date.now() - start,
          externalContent,
          content: wrapWebContent(parsed.answer ?? "No response", "web_search"),
          citations: parsed.citations,
        };

  writeCachedSearchPayload(cacheKey, payload, resolveSearchCacheTtlMs(searchConfig));
  return payload;
}

export async function executeBailianWebSearchProviderTool(
  ctx: { config?: OpenClawConfig; searchConfig?: SearchConfigRecord },
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const searchConfig = mergeScopedSearchConfig(
    ctx.searchConfig,
    "bailian",
    resolveProviderWebSearchPluginConfig(ctx.config, "bailian"),
  );
  return await executeBailianWebSearch(args, searchConfig);
}

export async function runBailianSearchProviderSetup(
  ctx: WebSearchProviderSetupContext,
): Promise<WebSearchProviderSetupContext["config"]> {
  const existingPluginConfig = resolveProviderWebSearchPluginConfig(ctx.config, "bailian");
  const mode = resolveBailianMode(existingPluginConfig as BailianConfig | undefined);
  const selectedMode = await ctx.prompter.select<BailianMode>({
    message: "Bailian web search mode",
    options: [
      {
        value: "answer",
        label: "Answer",
        hint: "AI-synthesized answer with citations",
      },
      {
        value: "results",
        label: "Results",
        hint: "Structured result list with titles and snippets",
      },
    ],
    initialValue: mode || BAILIAN_DEFAULT_MODE,
  });

  const next = { ...ctx.config };
  setProviderWebSearchPluginConfigValue(next, "bailian", "mode", selectedMode);
  return next;
}

export const __testing = {
  buildBailianMcpDiagnosticError,
  parseBailianCallToolResult,
  probeBailianInitialize,
  unwrapBailianJsonRpcResult,
  resolveBailianApiKey,
  resolveBailianMode,
} as const;
