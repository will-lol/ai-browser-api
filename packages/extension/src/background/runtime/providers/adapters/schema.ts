import type {
  AuthMethodDefinition,
  RuntimeAuthMethod,
} from "./types";
export { defineAuthSchema, parseAuthMethodValues } from "@/shared/api/auth-schema";
import { getAuthSchemaFields } from "@/shared/api/auth-schema";

export function toRuntimeAuthMethod(
  method: AuthMethodDefinition,
): RuntimeAuthMethod {
  return {
    id: method.id.trim(),
    type: method.type,
    label: method.label.trim() || method.id.trim(),
    fields: getAuthSchemaFields(method.inputSchema),
  };
}
