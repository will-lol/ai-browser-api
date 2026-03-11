import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import * as Schema from "effect/Schema";
import { mergeModelHeaders } from "./factory-language-model";
import { parseOptionalMetadataObject } from "./auth-metadata";
import { wrapLanguageModel } from "./helpers";
import {
  parseOptionalTrimmedString,
  parseProviderOptions,
} from "./provider-options";
import { defineAuthSchema } from "./schema";
import type {
  AIAdapter,
  AdapterAuthorizeContext,
  RuntimeAdapterContext,
} from "./types";
import { browser } from "@wxt-dev/browser";
import type { AuthRecord } from "@/background/runtime/auth/auth-store";
import { normalizeDomain, sleep } from "@/background/runtime/auth/oauth-util";
import { isObject } from "@/background/runtime/core/util";
import { decodeSchemaOrUndefined } from "@/background/runtime/core/effect-schema";

const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const;
const CLIENT_ID = "Iv1.b507a08c87ecfe98";
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3_000;

type CopilotAuthMetadata = {
  enterpriseUrl?: string;
};

const copilotProviderOptionsSchema = Schema.Struct({
  baseURL: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});

type CopilotProviderOptions = Schema.Schema.Type<
  typeof copilotProviderOptionsSchema
>;

const copilotAuthMetadataSchema = Schema.Struct({
  enterpriseUrl: Schema.optional(Schema.String),
});

const copilotDeviceCodeSchema = Schema.Struct({
  verification_uri: Schema.String,
  user_code: Schema.String,
  device_code: Schema.String,
  interval: Schema.Number,
  expires_in: Schema.optional(Schema.Number),
});

const copilotAccessTokenPollSchema = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Number),
});

const copilotApiKeySchema = Schema.Struct({
  token: Schema.String,
  expires_at: Schema.optional(Schema.Number),
});

const RESPONSES_API_ALTERNATE_INPUT_TYPES = new Set([
  "file_search_call",
  "computer_call",
  "computer_call_output",
  "web_search_call",
  "function_call",
  "function_call_output",
  "image_generation_call",
  "code_interpreter_call",
  "local_shell_call",
  "local_shell_call_output",
  "mcp_list_tools",
  "mcp_approval_request",
  "mcp_approval_response",
  "mcp_call",
  "reasoning",
]);

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error("Authentication canceled");
  }
}

function getUrls(domain: string) {
  return {
    deviceCodeURL: `https://${domain}/login/device/code`,
    accessTokenURL: `https://${domain}/login/oauth/access_token`,
    copilotApiKeyURL: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

function buildCopilotSettings(input: {
  providerID: string;
  providerOptions: CopilotProviderOptions;
  modelURL: string;
  modelHeaders?: Record<string, string>;
  baseURL?: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  fetch?: typeof fetch;
}): Parameters<typeof createOpenAICompatible>[0] {
  return {
    baseURL: input.baseURL || input.providerOptions.baseURL || input.modelURL,
    apiKey: input.apiKey,
    headers: {
      ...(input.modelHeaders ?? {}),
      ...(input.extraHeaders ?? {}),
    },
    fetch: input.fetch,
    name: input.providerOptions.name || input.providerID,
  };
}

function inspectCopilotRequest(options: Record<string, unknown>) {
  let isAgent = false;
  let isVision = false;

  const messages = Array.isArray(options.messages)
    ? options.messages
    : undefined;
  if (messages && messages.length > 0) {
    const last = messages[messages.length - 1];
    if (isObject(last)) {
      const role = parseOptionalTrimmedString(last.role);
      isAgent = role === "assistant" || role === "tool";
    }

    isVision = messages.some((message) => {
      if (!isObject(message)) return false;
      if (!Array.isArray(message.content)) return false;
      return message.content.some((part) => {
        if (!isObject(part)) return false;
        return part.type === "image_url";
      });
    });
  }

  const input = Array.isArray(options.input) ? options.input : undefined;
  if (input && input.length > 0) {
    const lastInput = input[input.length - 1];
    if (isObject(lastInput)) {
      const role = parseOptionalTrimmedString(lastInput.role);
      const inputType = parseOptionalTrimmedString(lastInput.type);
      const hasAgentType = Boolean(
        inputType && RESPONSES_API_ALTERNATE_INPUT_TYPES.has(inputType),
      );
      if (role === "assistant" || hasAgentType) {
        isAgent = true;
      }

      const content = Array.isArray(lastInput.content)
        ? lastInput.content
        : undefined;
      if (
        content &&
        content.some((part) => {
          if (!isObject(part)) return false;
          return part.type === "input_image";
        })
      ) {
        isVision = true;
      }
    }
  }

  return {
    isVision,
    isAgent,
  };
}

function buildVerificationUrl(input: {
  verificationUri: string;
  userCode: string;
}) {
  try {
    const url = new URL(input.verificationUri);
    url.searchParams.set("user_code", input.userCode);
    return url.toString();
  } catch {
    const separator = input.verificationUri.includes("?") ? "&" : "?";
    return `${input.verificationUri}${separator}user_code=${encodeURIComponent(input.userCode)}`;
  }
}

function shouldRefreshCopilotAccessToken(input: {
  access?: string;
  expiresAt?: number;
  now: number;
}) {
  if (!input.access) return true;
  if (!input.expiresAt) return true;
  return input.expiresAt <= input.now + 60_000;
}

function normalizeCopilotAuth(
  auth?: AuthRecord,
): AuthRecord<CopilotAuthMetadata> | undefined {
  if (!auth) return undefined;
  if (auth.type !== "oauth") return auth;

  return {
    ...auth,
    metadata: parseOptionalMetadataObject(
      copilotAuthMetadataSchema,
      auth.metadata,
    ),
  };
}

async function parseCopilotJson<
  TSchema extends Schema.Schema.AnyNoContext,
>(input: { response: Response; schema: TSchema; message: string }) {
  const payload = await input.response.json().catch(() => undefined);
  const result = decodeSchemaOrUndefined(input.schema, payload);
  if (result) return result;
  throw new Error(input.message);
}

async function authorizeCopilotDevice(
  input: AdapterAuthorizeContext<{
    deploymentType?: "github.com" | "enterprise";
    enterpriseUrl?: string;
  }>,
) {
  const deploymentType = input.values.deploymentType?.trim().toLowerCase();
  const enterpriseInput = input.values.enterpriseUrl?.trim();
  const enterprise =
    deploymentType === "enterprise" || Boolean(enterpriseInput);

  const domain =
    enterprise && enterpriseInput
      ? normalizeDomain(enterpriseInput)
      : "github.com";
  const urls = getUrls(domain);

  const deviceResponse = await fetch(urls.deviceCodeURL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": COPILOT_HEADERS["User-Agent"],
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      scope: "read:user",
    }),
  });

  if (!deviceResponse.ok) {
    const detail = await deviceResponse.text().catch(() => "");
    throw new Error(
      `Failed to initiate Copilot device authorization (${deviceResponse.status}): ${detail.slice(0, 300)}`,
    );
  }

  const deviceData = await parseCopilotJson({
    response: deviceResponse,
    schema: copilotDeviceCodeSchema,
    message: "Copilot device authorization returned an invalid response.",
  });

  const verificationUrl = buildVerificationUrl({
    verificationUri: deviceData.verification_uri,
    userCode: deviceData.user_code,
  });

  let autoOpened = false;
  await browser.tabs
    .create({
      url: verificationUrl,
    })
    .then(() => {
      autoOpened = true;
    })
    .catch(() => {
      // Ignore tab creation errors and continue polling for completion.
    });

  await input.authFlow.publish({
    kind: "device_code",
    title: "Enter the device code to continue",
    message:
      "Open the verification page and enter this code to finish signing in.",
    code: deviceData.user_code,
    url: verificationUrl,
    autoOpened,
  });

  const expiresInMs = Math.max(deviceData.expires_in ?? 900, 30) * 1000;
  const deadline = Date.now() + expiresInMs;
  let intervalSeconds = Math.max(deviceData.interval || 5, 1);

  while (Date.now() < deadline) {
    throwIfAborted(input.signal);
    const response = await fetch(urls.accessTokenURL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": COPILOT_HEADERS["User-Agent"],
      },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceData.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Copilot token polling failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    const data = await parseCopilotJson({
      response,
      schema: copilotAccessTokenPollSchema,
      message: "Copilot token polling returned an invalid response.",
    });

    if (data.access_token) {
      return {
        type: "oauth" as const,
        methodID: "oauth-device" as const,
        methodType: "oauth" as const,
        access: "",
        refresh: data.access_token,
        expiresAt: 0,
        metadata: enterprise ? { enterpriseUrl: domain } : undefined,
      };
    }

    if (data.error === "authorization_pending") {
      await sleep(intervalSeconds * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS);
      throwIfAborted(input.signal);
      continue;
    }

    if (data.error === "slow_down") {
      intervalSeconds =
        data.interval && data.interval > 0
          ? data.interval
          : intervalSeconds + 5;
      await sleep(intervalSeconds * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS);
      throwIfAborted(input.signal);
      continue;
    }

    throw new Error(
      `Copilot authorization failed: ${data.error_description ?? data.error ?? "unknown_error"}`,
    );
  }

  throw new Error(
    `Copilot device authorization timed out. Enter code: ${deviceData.user_code}`,
  );
}

export async function resolveCopilotExecutionState(
  context: RuntimeAdapterContext,
) {
  const auth = normalizeCopilotAuth(context.auth);

  if (!auth) {
    return {
      apiKey: undefined,
      baseURL: context.model.api.url,
    };
  }

  if (auth.type !== "oauth") {
    return {
      apiKey: auth.type === "api" ? auth.key : undefined,
      baseURL: context.model.api.url,
    };
  }

  const enterpriseUrl = auth.metadata?.enterpriseUrl;
  const domain = enterpriseUrl ? normalizeDomain(enterpriseUrl) : "github.com";
  const baseURL = enterpriseUrl
    ? `https://copilot-api.${normalizeDomain(enterpriseUrl)}`
    : "https://api.githubcopilot.com";
  const urls = getUrls(domain);

  let access = auth.access;
  const refresh = auth.refresh;
  const expiresAt = auth.expiresAt;

  if (
    shouldRefreshCopilotAccessToken({
      access,
      expiresAt,
      now: context.runtime.now(),
    }) &&
    refresh
  ) {
    const response = await fetch(urls.copilotApiKeyURL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${refresh}`,
        ...COPILOT_HEADERS,
      },
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Copilot token refresh failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    const tokenData = await parseCopilotJson({
      response,
      schema: copilotApiKeySchema,
      message: "Copilot token refresh returned an invalid response.",
    });

    access = tokenData.token;
    await context.authStore.set({
      type: "oauth",
      access,
      refresh,
      expiresAt:
        typeof tokenData.expires_at === "number"
          ? tokenData.expires_at * 1000 - 5 * 60 * 1000
          : context.runtime.now() + 25 * 60_000,
      accountId: auth.accountId,
      methodID: auth.methodID,
      methodType: auth.methodType,
      metadata: enterpriseUrl
        ? { enterpriseUrl: normalizeDomain(enterpriseUrl) }
        : undefined,
    });
  }

  if (!access) {
    throw new Error(
      "Copilot OAuth access token is unavailable. Reconnect GitHub Copilot and retry.",
    );
  }

  return {
    baseURL,
    apiKey: access,
  };
}

const optionalAuthStringSchema = Schema.Union(Schema.String, Schema.Undefined);
const deploymentTypeSchema = Schema.Union(
  Schema.Literal("github.com", "enterprise"),
  Schema.Undefined,
);

export const githubCopilotAdapter: AIAdapter = {
  key: "provider:github-copilot",
  displayName: "GitHub Copilot",
  match: {
    providerIDs: ["github-copilot"],
  },
  async listAuthMethods() {
    return [
      {
        id: "oauth-device",
        type: "oauth",
        label: "Login with GitHub Copilot",
        inputSchema: defineAuthSchema({
          deploymentType: {
            schema: deploymentTypeSchema,
            ui: {
              type: "select",
              label: "Deployment Type",
              required: false,
              defaultValue: "github.com",
              options: [
                {
                  label: "GitHub.com",
                  value: "github.com",
                },
                {
                  label: "Enterprise",
                  value: "enterprise",
                },
              ],
            },
          },
          enterpriseUrl: {
            schema: optionalAuthStringSchema,
            ui: {
              type: "text",
              label: "Enterprise URL (if using enterprise)",
              placeholder: "company.ghe.com",
              required: false,
              condition: {
                key: "deploymentType",
                equals: "enterprise",
              },
            },
          },
        }),
        authorize: authorizeCopilotDevice,
      },
    ];
  },
  async patchCatalog(ctx, provider) {
    const models = await Promise.all(
      Object.entries(provider.models).map(async ([modelID, model]) => [
        modelID,
        {
          ...model,
          api: {
            ...model.api,
            npm: "@ai-sdk/github-copilot",
          },
          cost: {
            input: 0,
            output: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        },
      ]),
    );

    return {
      ...provider,
      models: Object.fromEntries(models),
    };
  },
  async createModel(context) {
    const providerOptions = parseProviderOptions(
      copilotProviderOptionsSchema,
      context.provider.options,
    );
    const execution = await resolveCopilotExecutionState(context);
    const provider = createOpenAICompatible(
      buildCopilotSettings({
        providerID: context.providerID,
        providerOptions,
        modelURL: context.model.api.url,
        modelHeaders: context.model.headers,
        baseURL: execution.baseURL,
        apiKey: execution.apiKey,
      }),
    );
    const baseModel = provider.languageModel(context.model.api.id);

    return wrapLanguageModel(baseModel, async (options) => {
      const { isAgent, isVision } = inspectCopilotRequest(
        options as unknown as Record<string, unknown>,
      );
      return mergeModelHeaders(options, {
        ...COPILOT_HEADERS,
        "X-Initiator": isAgent ? "agent" : "user",
        "Openai-Intent": "conversation-edits",
        ...(isVision ? { "Copilot-Vision-Request": "true" } : {}),
      });
    });
  },
};
