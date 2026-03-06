export type AuthRecord =
  | {
      type: "api"
      key: string
      metadata?: Record<string, string>
      createdAt: number
      updatedAt: number
    }
  | {
      type: "oauth"
      access: string
      refresh?: string
      expiresAt?: number
      accountId?: string
      metadata?: Record<string, string>
      createdAt: number
      updatedAt: number
    }

export type AuthResult =
  | { type: "api"; key: string; metadata?: Record<string, string> }
  | {
      type: "oauth"
      access: string
      refresh?: string
      expiresAt?: number
      accountId?: string
      metadata?: Record<string, string>
    }
