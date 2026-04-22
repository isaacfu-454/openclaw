import { withEnv } from "openclaw/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createWizardPrompter } from "../../../test/helpers/wizard-prompter.js";
import { __testing, runBailianSearchProviderSetup } from "./bailian-web-search-provider.runtime.js";

describe("bailian web search provider", () => {
  it("defaults mode to answer and accepts results override", () => {
    expect(__testing.resolveBailianMode()).toBe("answer");
    expect(__testing.resolveBailianMode({ mode: "results" })).toBe("results");
    expect(__testing.resolveBailianMode({ mode: "unknown" })).toBe("answer");
  });

  it("uses configured apiKey before env fallbacks", () => {
    expect(__testing.resolveBailianApiKey({ apiKey: "configured-key" })).toBe("configured-key");
  });

  it("falls back across Bailian env var aliases", () => {
    withEnv({ DASHSCOPE_API_KEY: "dashscope-key" }, () => {
      expect(__testing.resolveBailianApiKey({})).toBe("dashscope-key");
    });
    withEnv({ MODELSTUDIO_API_KEY: "modelstudio-key" }, () => {
      expect(__testing.resolveBailianApiKey({})).toBe("modelstudio-key");
    });
    withEnv({ QWEN_API_KEY: "qwen-key" }, () => {
      expect(__testing.resolveBailianApiKey({})).toBe("qwen-key");
    });
  });

  it("parses answer payloads with citations from text blocks and structured content", () => {
    expect(
      __testing.parseBailianCallToolResult({
        content: [
          {
            type: "text",
            text: "Bailian answer text",
          },
        ],
        structuredContent: {
          citations: [{ url: "https://a.test" }, { link: "https://b.test" }],
        },
      }),
    ).toEqual({
      answer: "Bailian answer text",
      citations: ["https://a.test", "https://b.test"],
      results: [],
    });
  });

  it("parses JSON text payloads into structured search results", () => {
    expect(
      __testing.parseBailianCallToolResult({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              results: [
                {
                  title: "OpenClaw",
                  url: "https://openclaw.ai",
                  snippet: "OpenClaw docs",
                },
              ],
            }),
          },
        ],
      }),
    ).toEqual({
      answer: "OpenClaw docs",
      citations: ["https://openclaw.ai"],
      results: [
        {
          title: "OpenClaw",
          url: "https://openclaw.ai",
          snippet: "OpenClaw docs",
        },
      ],
    });
  });

  it("keeps answer mode concise and excludes host logo URLs from citations", () => {
    const parsed = __testing.parseBailianCallToolResult({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            pages: [
              {
                title: "null",
                snippet:
                  "OpenClaw is a local-first assistant platform that supports web tools, browser automation, and multi-channel chat integrations.",
                hostlogo: "https://cdn.example/logo.png",
                url: "https://docs.openclaw.ai/guide",
              },
              {
                title: "OpenClaw Docs",
                snippet:
                  "The docs cover install, configuration, Docker deployment, and safety guidance for local operation.",
                hostlogo: "https://cdn.example/logo-2.png",
                url: "https://openclaw.ai/docs",
              },
            ],
            request_id: "req-1",
            status: 0,
          }),
        },
      ],
    });

    expect(parsed.answer).toContain("OpenClaw is a local-first assistant platform");
    expect(parsed.answer).toContain("OpenClaw Docs:");
    expect(parsed.citations).toEqual([
      "https://docs.openclaw.ai/guide",
      "https://openclaw.ai/docs",
    ]);
  });

  it("unwraps successful Bailian JSON-RPC envelopes", () => {
    expect(
      __testing.unwrapBailianJsonRpcResult("tools/call", {
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [
            {
              type: "text",
              text: "{}",
            },
          ],
          isError: false,
        },
      }),
    ).toEqual({
      content: [
        {
          type: "text",
          text: "{}",
        },
      ],
      isError: false,
    });
  });

  it("surfaces Bailian JSON-RPC errors", () => {
    expect(() =>
      __testing.unwrapBailianJsonRpcResult("tools/call", {
        jsonrpc: "2.0",
        id: 3,
        error: {
          code: -32000,
          message: "upstream failed",
        },
      }),
    ).toThrow("Bailian tools/call failed: upstream failed (code -32000)");
  });

  it("adds HTTP probe details to Bailian MCP transport errors", () => {
    expect(
      __testing.buildBailianMcpDiagnosticError(new Error("Streamable HTTP error"), {
        kind: "http",
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        contentType: "application/json",
        bodyPreview: '{"code":"InternalError"}',
      }).message,
    ).toContain(
      'Streamable HTTP error. Bailian MCP initialize probe returned HTTP 500 Internal Server Error (application/json). Body: {"code":"InternalError"}',
    );
  });

  it("adds probe failure details when initialize diagnostics cannot reach the endpoint", () => {
    expect(
      __testing.buildBailianMcpDiagnosticError(new Error("Streamable HTTP error"), {
        kind: "error",
        error: "fetch failed",
      }).message,
    ).toBe(
      "Streamable HTTP error. Bailian MCP initialize probe failed before search: fetch failed.",
    );
  });

  it("stores selected mode during setup", async () => {
    const select = vi.fn().mockResolvedValue("results");
    const next = await runBailianSearchProviderSetup({
      config: {},
      runtime: {} as never,
      prompter: createWizardPrompter({
        select: select as never,
      }),
    });

    expect(next.plugins?.entries?.bailian?.config?.webSearch).toMatchObject({
      mode: "results",
    });
  });
});
