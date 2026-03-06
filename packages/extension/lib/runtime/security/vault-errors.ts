import * as Data from "effect/Data"

export class VaultKeyUnavailableError extends Data.TaggedError(
  "VaultKeyUnavailableError",
)<{
  operation: string
  message: string
}> {}

export class VaultEncryptError extends Data.TaggedError("VaultEncryptError")<{
  providerID: string
  message: string
}> {}

export class VaultDecryptError extends Data.TaggedError("VaultDecryptError")<{
  providerID: string
  message: string
}> {}
