// @ts-expect-error bun:test types are not part of this package's TypeScript environment.
import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"
import * as Effect from "effect/Effect"

const vaultKeyRows = new Map<
  string,
  {
    id: "auth-master-key"
    key: CryptoKey
    algorithm: "AES-GCM"
    version: number
    createdAt: number
    updatedAt: number
  }
>()

const getMock = mock(async (id: string) => vaultKeyRows.get(id))
const putMock = mock(
  async (row: {
    id: "auth-master-key"
    key: CryptoKey
    algorithm: "AES-GCM"
    version: number
    createdAt: number
    updatedAt: number
  }) => {
    vaultKeyRows.set(row.id, row)
  },
)

mock.module("@/lib/runtime/db/runtime-db", () => ({
  runtimeDb: {
    vaultKeys: {
      get: getMock,
      put: putMock,
    },
  },
}))

const { AUTH_MASTER_KEY_ID, makeVaultKeyProvider } = await import(
  "./vault-key-provider"
)

beforeEach(() => {
  vaultKeyRows.clear()
  getMock.mockClear()
  putMock.mockClear()
})

afterAll(() => {
  mock.restore()
})

describe("makeVaultKeyProvider", () => {
  it("creates one non-extractable auth key and reuses the stored key", async () => {
    const firstProvider = makeVaultKeyProvider()
    const firstKey = await Effect.runPromise(firstProvider.getOrCreateAuthKey)
    const cachedKey = await Effect.runPromise(firstProvider.getOrCreateAuthKey)

    expect(firstKey).toBe(cachedKey)
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(vaultKeyRows.get(AUTH_MASTER_KEY_ID)?.algorithm).toBe("AES-GCM")

    const secondProvider = makeVaultKeyProvider()
    const secondKey = await Effect.runPromise(secondProvider.getOrCreateAuthKey)

    expect(secondKey).toBe(firstKey)
    expect(putMock).toHaveBeenCalledTimes(1)
    await expect(crypto.subtle.exportKey("raw", firstKey)).rejects.toBeDefined()
  })
})
