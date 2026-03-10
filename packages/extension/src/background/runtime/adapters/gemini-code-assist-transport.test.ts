import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGeminiCodeAssistFetch,
  normalizeGeminiCodeAssistResponse,
  rewriteGeminiCodeAssistRequest,
} from "@/background/runtime/adapters/gemini-code-assist-transport";

describe("gemini-code-assist transport request rewrite", () => {
  it("rewrites generateContent requests to code assist envelope", async () => {
    const rewritten = await rewriteGeminiCodeAssistRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer oauth-token",
          "Content-Type": "application/json",
          "x-goog-api-key": "should-be-removed",
          "x-api-key": "should-be-removed-too",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        }),
      },
      {
        projectId: "managed-project-1",
      },
    );

    assert.ok(rewritten);
    assert.equal(
      String(rewritten.request),
      "https://cloudcode-pa.googleapis.com/v1internal:generateContent",
    );

    const rewrittenHeaders = new Headers(rewritten.init.headers);
    assert.equal(rewrittenHeaders.get("authorization"), "Bearer oauth-token");
    assert.equal(rewrittenHeaders.get("x-goog-api-key"), null);
    assert.equal(rewrittenHeaders.get("x-api-key"), null);

    const body = JSON.parse(String(rewritten.init.body)) as Record<
      string,
      unknown
    >;
    assert.equal(body.project, "managed-project-1");
    assert.equal(body.model, "gemini-2.5-flash");
    assert.equal(typeof body.user_prompt_id, "string");
    assert.ok(body.request);
  });

  it("rewrites streamGenerateContent requests with SSE query", async () => {
    const rewritten = await rewriteGeminiCodeAssistRequest(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer oauth-token",
          "Content-Type": "application/json",
          "x-goog-api-key": "remove",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Hello stream" }] }],
        }),
      },
      {
        projectId: "managed-project-2",
      },
    );

    assert.ok(rewritten);
    assert.equal(
      String(rewritten.request),
      "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
    );
    assert.equal(rewritten.metadata.streaming, true);

    const rewrittenHeaders = new Headers(rewritten.init.headers);
    assert.equal(rewrittenHeaders.get("accept"), "text/event-stream");
    assert.equal(rewrittenHeaders.get("x-goog-api-key"), null);
  });
});

describe("gemini-code-assist transport response normalization", () => {
  it("unwraps JSON response payloads from { response: ... }", async () => {
    const response = new Response(
      JSON.stringify({
        response: {
          candidates: [{ content: { parts: [{ text: "done" }] } }],
        },
        traceId: "trace-1",
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );

    const normalized = await normalizeGeminiCodeAssistResponse(response, {
      streaming: false,
      requestedModel: "gemini-2.5-flash",
    });
    const body = (await normalized.json()) as Record<string, unknown>;
    assert.equal(Array.isArray(body.candidates), true);
    assert.equal((body.candidates as unknown[]).length, 1);
    assert.equal(body.responseId, "trace-1");
  });

  it("unwraps SSE data frames and preserves non-data lines", async () => {
    const response = new Response(
      [
        "event: message",
        'data: {"response":{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]},"traceId":"trace-2"}',
        "",
      ].join("\n"),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
      },
    );

    const normalized = await normalizeGeminiCodeAssistResponse(response, {
      streaming: true,
      requestedModel: "gemini-2.5-pro",
    });
    const text = await normalized.text();
    const lines = text.split("\n");

    assert.equal(lines[0], "event: message");

    const dataLine = lines.find((line) => line.startsWith("data: "));
    assert.ok(dataLine);
    const payload = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
    assert.equal(payload.responseId, "trace-2");
    assert.equal(Array.isArray(payload.candidates), true);
  });
});

describe("gemini-code-assist fetch wrapper", () => {
  it("rewrites and forwards a single fetch attempt", async () => {
    let callCount = 0;

    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      callCount += 1;

      assert.equal(
        String(input),
        "https://cloudcode-pa.googleapis.com/v1internal:generateContent",
      );

      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer oauth-token");

      return new Response(
        JSON.stringify({
          response: {
            candidates: [{ content: { parts: [{ text: "done" }] } }],
          },
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const wrappedFetch = createGeminiCodeAssistFetch({
      projectId: "managed-project-3",
      fetchFn,
    });

    const response = await wrappedFetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer oauth-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        }),
      },
    );

    assert.equal(callCount, 1);
    assert.equal(response.status, 429);

    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(Array.isArray(body.candidates), true);
  });
});
