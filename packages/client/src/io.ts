import type { IoCapabilities, IoInterface, IoMessage } from "kkrpc/browser"

const DESTROY_SIGNAL = "__DESTROY__"

export class MessagePortIO implements IoInterface {
  name = "message-port-io"
  capabilities: IoCapabilities = {
    structuredClone: true,
    transfer: true,
    transferTypes: ["ArrayBuffer", "MessagePort"],
  }

  private messageQueue: Array<string | IoMessage> = []
  private resolveRead: ((value: string | IoMessage | null) => void) | null = null
  private messageListeners: Set<(message: string | IoMessage) => void> = new Set()

  constructor(private port: MessagePort) {
    this.port.onmessage = this.handleMessage.bind(this)
  }

  private handleMessage(event: MessageEvent) {
    const message = this.normalizeIncoming(event.data)

    if (message === DESTROY_SIGNAL) {
      this.destroy()
      return
    }

    if (this.messageListeners.size > 0) {
      this.messageListeners.forEach((listener) => listener(message))
    } else if (this.resolveRead) {
      this.resolveRead(message)
      this.resolveRead = null
    } else {
      this.messageQueue.push(message)
    }
  }

  private normalizeIncoming(message: any): string | IoMessage {
    if (typeof message === "string") {
      return message
    }

    if (message && typeof message === "object" && message.version === 2) {
      return {
        data: message,
        transfers: (message.__transferredValues as unknown[] | undefined) ?? [],
      }
    }

    return message as string
  }

  on(event: "message", listener: (message: string | IoMessage) => void): void
  on(event: "error", listener: (error: Error) => void): void
  on(event: "message" | "error", listener: Function): void {
    if (event === "message") {
      this.messageListeners.add(listener as (message: string | IoMessage) => void)
    }
  }

  off(event: "message" | "error", listener: Function): void {
    if (event === "message") {
      this.messageListeners.delete(listener as (message: string | IoMessage) => void)
    }
  }

  async read(): Promise<string | IoMessage | null> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift() ?? null
    }

    return new Promise((resolve) => {
      this.resolveRead = resolve
    })
  }

  async write(message: string | IoMessage): Promise<void> {
    if (typeof message === "string") {
      this.port.postMessage(message)
    } else if (message.transfers && message.transfers.length > 0) {
      this.port.postMessage(message.data, message.transfers as Transferable[])
    } else {
      this.port.postMessage(message.data)
    }
  }

  destroy(): void {
    this.port.close()
  }

  signalDestroy(): void {
    this.port.postMessage(DESTROY_SIGNAL)
  }
}
