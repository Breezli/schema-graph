import type { VirtualSchemaFile } from '@/domain/schema'

import {
  createParseSchemaProjectRequest,
  type SchemaParserWorkerResponse,
} from './schema-parser-protocol'

interface PendingRequest {
  readonly resolve: (response: SchemaParserWorkerResponse) => void
  readonly reject: (error: Error) => void
}

export class SchemaParserWorkerClient {
  readonly #worker: Worker
  readonly #pending = new Map<number, PendingRequest>()

  constructor() {
    this.#worker = new Worker(new URL('./schema-parser.worker.ts', import.meta.url), {
      type: 'module',
      name: 'schema-parser',
    })
    this.#worker.addEventListener('message', this.#handleMessage)
    this.#worker.addEventListener('error', this.#handleError)
  }

  parse(
    revision: number,
    files: readonly VirtualSchemaFile[],
  ): Promise<SchemaParserWorkerResponse> {
    const superseded = [...this.#pending.keys()].filter(
      (pendingRevision) => pendingRevision < revision,
    )
    for (const pendingRevision of superseded) {
      this.#pending
        .get(pendingRevision)
        ?.reject(new Error(`解析请求 ${pendingRevision} 已被更新版本取代。`))
      this.#pending.delete(pendingRevision)
    }

    return new Promise((resolve, reject) => {
      this.#pending.set(revision, { resolve, reject })
      this.#worker.postMessage(createParseSchemaProjectRequest(revision, files))
    })
  }

  dispose(): void {
    this.#worker.removeEventListener('message', this.#handleMessage)
    this.#worker.removeEventListener('error', this.#handleError)
    this.#worker.terminate()
    for (const request of this.#pending.values()) {
      request.reject(new Error('Schema Parser Worker 已关闭。'))
    }
    this.#pending.clear()
  }

  readonly #handleMessage = (event: MessageEvent<SchemaParserWorkerResponse>): void => {
    const response = event.data
    const request = this.#pending.get(response.revision)
    if (!request) return
    request.resolve(response)
    this.#pending.delete(response.revision)
  }

  readonly #handleError = (event: ErrorEvent): void => {
    const error = new Error(event.message || 'Schema Parser Worker 执行失败。')
    for (const request of this.#pending.values()) request.reject(error)
    this.#pending.clear()
  }
}
