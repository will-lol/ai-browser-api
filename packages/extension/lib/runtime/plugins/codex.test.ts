import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { __codexAuthInternals } from "@/lib/runtime/plugins/codex"

describe("codex browser oauth internals", () => {
  it("builds authorization URL with localhost callback and codex originator", () => {
    const url = new URL(__codexAuthInternals.buildCodexAuthorizationURL({
      codeChallenge: "challenge-token",
      state: "state-token",
    }))

    assert.equal(url.origin + url.pathname, "https://auth.openai.com/oauth/authorize")
    assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:1455/auth/callback")
    assert.equal(url.searchParams.get("codex_cli_simplified_flow"), "true")
    assert.equal(url.searchParams.get("originator"), "codex_cli_rs")
    assert.equal(url.searchParams.get("code_challenge"), "challenge-token")
    assert.equal(url.searchParams.get("state"), "state-token")
  })

  it("matches only localhost codex callback URLs", () => {
    assert.equal(
      __codexAuthInternals.isCodexOAuthCallbackURL("http://localhost:1455/auth/callback?code=abc&state=xyz"),
      true,
    )
    assert.equal(
      __codexAuthInternals.isCodexOAuthCallbackURL("http://localhost:1455/auth/wrong?code=abc"),
      false,
    )
    assert.equal(
      __codexAuthInternals.isCodexOAuthCallbackURL("https://auth.openai.com/codex/device"),
      false,
    )
  })

  it("intercepts localhost callback URL via webRequest listener", async () => {
    type CallbackDetails = {
      type: string
      url: string
    }

    let listener: ((details: CallbackDetails) => unknown) | undefined
    let removeCalls = 0
    const onBeforeRequest = {
      addListener(nextListener: (details: CallbackDetails) => unknown, filter: unknown) {
        listener = nextListener
        assert.deepEqual(filter, {
          urls: ["http://localhost:1455/auth/callback*"],
          types: ["main_frame"],
        })
      },
      removeListener(nextListener: (details: CallbackDetails) => unknown) {
        if (nextListener === listener) {
          removeCalls += 1
        }
      },
    } as never

    const callbackPromise = __codexAuthInternals.waitForCodexOAuthCallback(undefined, onBeforeRequest)
    assert.ok(listener)

    listener?.({
      type: "xmlhttprequest",
      url: "http://localhost:1455/auth/callback?code=ignored",
    })

    const expectedCallbackURL = "http://localhost:1455/auth/callback?code=abc&state=state-token"
    listener?.({
      type: "main_frame",
      url: expectedCallbackURL,
    })

    const callbackURL = await callbackPromise
    assert.equal(callbackURL, expectedCallbackURL)
    assert.equal(removeCalls, 1)
  })

  it("returns actionable error when webRequest is unavailable", async () => {
    await assert.rejects(
      () => __codexAuthInternals.waitForCodexOAuthCallback(undefined, undefined),
      /headless.*device auth/i,
    )
  })
})

describe("codex device instruction payload", () => {
  it("builds generic device_code instruction payload", () => {
    const instruction = __codexAuthInternals.buildCodexDeviceInstruction({
      code: "1234-ABCD",
      url: "https://auth.openai.com/codex/device",
      autoOpened: true,
    })

    assert.deepEqual(instruction, {
      kind: "device_code",
      title: "Enter the device code to continue",
      message: "Open the verification page and enter this code to finish signing in.",
      code: "1234-ABCD",
      url: "https://auth.openai.com/codex/device",
      autoOpened: true,
    })
  })
})

describe("codex chat header patch", () => {
  it("includes codex parity headers", () => {
    const headers = __codexAuthInternals.buildCodexChatHeaders({
      accept: "application/json",
    }, "session-123")

    assert.equal(headers.originator, "codex_cli_rs")
    assert.equal(headers["OpenAI-Beta"], "responses=experimental")
    assert.equal(headers.session_id, "session-123")
    assert.equal(headers.accept, "application/json")
  })
})

describe("codex request options patch", () => {
  it("forces store=false and derives instructions from system message when missing", () => {
    const patch = __codexAuthInternals.buildCodexRequestOptions({
      messages: [
        { role: "system", content: "Use safe defaults." },
        { role: "user", content: "hello" },
      ],
    })

    assert.equal(patch.store, false)
    assert.equal(patch.instructions, "Use safe defaults.")
  })

  it("forces store=false without overriding explicit top-level instructions", () => {
    const patch = __codexAuthInternals.buildCodexRequestOptions({
      instructions: "Explicit instructions",
      messages: [{ role: "system", content: "System should not override explicit instructions." }],
    })

    assert.deepEqual(patch, {
      store: false,
    })
  })

  it("forces store=false without overriding explicit providerOptions instructions", () => {
    const patch = __codexAuthInternals.buildCodexRequestOptions({
      providerOptions: {
        openai: {
          instructions: "Provider instructions",
        },
      },
    })

    assert.deepEqual(patch, {
      store: false,
    })
  })

  it("falls back to a generic default instruction when no system instruction exists", () => {
    const patch = __codexAuthInternals.buildCodexRequestOptions({
      messages: [{ role: "user", content: "hello" }],
    })

    assert.equal(patch.store, false)
    assert.equal(patch.instructions, "Follow the user's instructions.")
  })
})
