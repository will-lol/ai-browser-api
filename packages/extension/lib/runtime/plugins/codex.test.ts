import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { __codexAuthInternals } from "@/lib/runtime/plugins/codex"

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
