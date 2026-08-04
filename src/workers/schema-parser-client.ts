import type { VirtualSchemaFile } from '@/domain/schema'

import {
  createParseSchemaProjectRequest,
  type SchemaParserRequestIdentity,
  type SchemaParserWorkerResponse,
} from './schema-parser-protocol'

interface PendingRequest {
  readonly resolve: (response: SchemaParserWorkerResponse) => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

export type SchemaParserWorkerFactory = () => Worker

export interface SchemaParserWorkerClientOptions {
  readonly requestTimeoutMs?: number
}

export class SchemaParserWorkerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Schema Parser Worker 在 ${timeoutMs}ms 内未响应。`)
    this.name = 'SchemaParserWorkerTimeoutError'
  }
}

function createSchemaParserWorker(): Worker {
  return new Worker(new URL('./schema-parser.worker.ts', import.meta.url), {
    type: 'module',
    name: 'schema-parser',
  })
}

export class SchemaParserWorkerClient {
  readonly #workerFactory: SchemaParserWorkerFactory
  readonly #requestTimeoutMs: number
  readonly #pending = new Map<string, PendingRequest>()
  #worker?: Worker
  #activeSessionId?: number
  #disposed = false

  constructor(
    workerFactory: SchemaParserWorkerFactory = createSchemaParserWorker,
    options: SchemaParserWorkerClientOptions = {},
  ) {
    this.#workerFactory = workerFactory
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 20_000
    if (!Number.isFinite(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new Error('Schema Parser Worker 超时时间必须是正有限数值。')
    }
    this.#ensureWorker()
  }

  parse(
    identity: SchemaParserRequestIdentity,
    files: readonly VirtualSchemaFile[],
  ): Promise<SchemaParserWorkerResponse> {
    if (this.#disposed) {
      return Promise.reject(new Error('Schema Parser Worker 已关闭。'))
    }
    this.startSession(identity.editorSessionId)
    for (const [key, pending] of this.#pending) {
      const pendingIdentity = parsePendingKey(key)
      if (
        pendingIdentity.editorSessionId === identity.editorSessionId &&
        pendingIdentity.projectId === identity.projectId &&
        pendingIdentity.revision < identity.revision
      ) {
        this.#rejectPending(
          key,
          pending,
          new Error(`解析请求 ${pendingIdentity.revision} 已被更新版本取代。`),
        )
      }
    }

    return new Promise((resolve, reject) => {
      const key = pendingKey(identity)
      if (this.#pending.has(key)) {
        reject(new Error(`解析请求 ${identity.revision} 已在处理中。`))
        return
      }
      const timeout = setTimeout(() => {
        if (!this.#pending.has(key)) return
        this.#failWorker(new SchemaParserWorkerTimeoutError(this.#requestTimeoutMs))
      }, this.#requestTimeoutMs)
      this.#pending.set(key, { resolve, reject, timeout })
      try {
        this.#ensureWorker().postMessage(
          createParseSchemaProjectRequest(identity, files),
        )
      } catch (error) {
        this.#failWorker(
          error instanceof Error
            ? error
            : new Error('Schema Parser Worker 请求发送失败。'),
        )
      }
    })
  }

  startSession(editorSessionId: number): void {
    if (this.#activeSessionId === editorSessionId) return
    this.#activeSessionId = editorSessionId
    for (const [key, request] of this.#pending) {
      this.#rejectPending(
        key,
        request,
        new Error('Schema 解析会话已被新的项目会话取代。'),
      )
    }
  }

  cancelSession(editorSessionId: number): void {
    for (const [key, request] of this.#pending) {
      if (parsePendingKey(key).editorSessionId !== editorSessionId) continue
      this.#rejectPending(key, request, new Error('Schema 解析会话已取消。'))
    }
    if (this.#activeSessionId === editorSessionId) this.#activeSessionId = undefined
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#destroyWorker()
    for (const [key, request] of this.#pending) {
      this.#rejectPending(key, request, new Error('Schema Parser Worker 已关闭。'))
    }
    this.#activeSessionId = undefined
  }

  #ensureWorker(): Worker {
    if (this.#disposed) throw new Error('Schema Parser Worker 已关闭。')
    if (this.#worker) return this.#worker
    const worker = this.#workerFactory()
    worker.addEventListener('message', this.#handleMessage)
    worker.addEventListener('error', this.#handleError)
    worker.addEventListener('messageerror', this.#handleMessageError)
    this.#worker = worker
    return worker
  }

  #destroyWorker(): void {
    const worker = this.#worker
    if (!worker) return
    worker.removeEventListener('message', this.#handleMessage)
    worker.removeEventListener('error', this.#handleError)
    worker.removeEventListener('messageerror', this.#handleMessageError)
    worker.terminate()
    this.#worker = undefined
  }

  #rejectPending(key: string, request: PendingRequest, error: Error): void {
    clearTimeout(request.timeout)
    this.#pending.delete(key)
    request.reject(error)
  }

  #failWorker(error: Error): void {
    this.#destroyWorker()
    for (const [key, request] of this.#pending) {
      this.#rejectPending(key, request, error)
    }
  }

  readonly #handleMessage = (event: MessageEvent<SchemaParserWorkerResponse>): void => {
    const response = event.data
    const key = pendingKey(response)
    const request = this.#pending.get(key)
    if (!request) return
    clearTimeout(request.timeout)
    this.#pending.delete(key)
    request.resolve(response)
  }

  readonly #handleError = (event: ErrorEvent): void => {
    this.#failWorker(new Error(event.message || 'Schema Parser Worker 执行失败。'))
  }

  readonly #handleMessageError = (): void => {
    this.#failWorker(new Error('Schema Parser Worker 返回了无法读取的消息。'))
  }
}

function pendingKey(identity: SchemaParserRequestIdentity): string {
  return `${identity.editorSessionId}\0${identity.projectId}\0${identity.revision}`
}

function parsePendingKey(key: string): SchemaParserRequestIdentity {
  const [session = '0', projectId = '', revision = '0'] = key.split('\0')
  return {
    editorSessionId: Number(session),
    projectId,
    revision: Number(revision),
  }
}
