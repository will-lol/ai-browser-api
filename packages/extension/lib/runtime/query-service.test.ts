// @ts-expect-error bun:test types are not part of this package's TypeScript environment.
import { beforeEach, describe, expect, it, mock } from "bun:test"

const TEST_ORIGIN = "https://example.test"
const TRUSTED_MODEL_ID = "openai/gpt-4o-mini"
const STALE_MODEL_ID = "missing/model"

const pendingRows: Array<{
  id: string
  origin: string
  modelId: string
  modelName: string
  provider: string
  capabilities: string[]
  requestedAt: number
  dismissed: boolean
  status: "pending" | "resolved"
}> = []

const modelRowsById = new Map<string, {
  id: string
  providerID: string
  capabilities: string[]
  info: {
    name: string
  }
}>()

const bulkGetMock = mock(async (modelIds: string[]) =>
  modelIds.map((modelId) => modelRowsById.get(modelId)),
)

mock.module("@/lib/runtime/db/runtime-db", () => ({
  runtimeDb: {
    models: {
      bulkGet: bulkGetMock,
    },
    pendingRequests: {
      where: (_field: string) => ({
        equals: (_value: string) => ({
          filter: (predicate: (row: typeof pendingRows[number]) => boolean) => ({
            toArray: async () => pendingRows.filter(predicate),
          }),
        }),
      }),
    },
  },
}))

mock.module("@/lib/runtime/provider-registry", () => ({
  listModelRows: mock(async () => []),
  listProviderRows: mock(async () => []),
}))

const { listPendingRequestsForOrigin } = await import("@/lib/runtime/query-service")
mock.restore()

beforeEach(() => {
  pendingRows.length = 0
  modelRowsById.clear()
  bulkGetMock.mockClear()
})

describe("listPendingRequestsForOrigin", () => {
  it("hydrates pending request display metadata from trusted model rows", async () => {
    pendingRows.push(
      {
        id: "prm_trusted",
        origin: TEST_ORIGIN,
        modelId: TRUSTED_MODEL_ID,
        modelName: "Spoofed model",
        provider: "spoofed-provider",
        capabilities: ["text"],
        requestedAt: 1,
        dismissed: false,
        status: "pending",
      },
      {
        id: "prm_stale",
        origin: TEST_ORIGIN,
        modelId: STALE_MODEL_ID,
        modelName: "Ghost model",
        provider: "ghost-provider",
        capabilities: ["vision"],
        requestedAt: 2,
        dismissed: false,
        status: "pending",
      },
    )

    modelRowsById.set(TRUSTED_MODEL_ID, {
      id: TRUSTED_MODEL_ID,
      providerID: "openai",
      capabilities: ["text", "code"],
      info: {
        name: "GPT-4o mini",
      },
    })

    const result = await listPendingRequestsForOrigin(TEST_ORIGIN)

    expect(result).toEqual([{
      id: "prm_trusted",
      origin: TEST_ORIGIN,
      modelId: TRUSTED_MODEL_ID,
      modelName: "GPT-4o mini",
      provider: "openai",
      capabilities: ["text", "code"],
      requestedAt: 1,
      dismissed: false,
      status: "pending",
    }])
    expect(bulkGetMock).toHaveBeenCalledWith([TRUSTED_MODEL_ID, STALE_MODEL_ID])
  })
})
