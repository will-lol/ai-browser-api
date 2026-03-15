import type { ModelCapabilities } from "./provider-registry-types";

export function inferCodeCapability(modelID: string) {
  const lower = modelID.toLowerCase();

  return (
    lower.includes("code") ||
    lower.includes("coder") ||
    lower.includes("gpt") ||
    lower.includes("claude")
  );
}

export function toCapabilityTags(
  capabilities: ModelCapabilities,
): ReadonlyArray<string> {
  const tags: string[] = [];

  if (capabilities.input.text || capabilities.output.text) {
    tags.push("text");
  }

  if (
    capabilities.attachment ||
    capabilities.input.image ||
    capabilities.input.video ||
    capabilities.input.pdf ||
    capabilities.output.image ||
    capabilities.output.video ||
    capabilities.output.pdf
  ) {
    tags.push("vision");
  }

  if (capabilities.reasoning) {
    tags.push("reasoning");
  }

  if (capabilities.code) {
    tags.push("code");
  }

  return tags;
}
