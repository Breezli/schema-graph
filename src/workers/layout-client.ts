import {
  getLayoutRequestIdentity,
  hasSameLayoutIdentity,
  validateLayoutRequest,
  validateLayoutResult,
  type LayoutRequest,
  type LayoutRequestIdentity,
  type LayoutResult,
} from './layout-protocol'

interface PendingLayoutRequest {
  readonly identity: LayoutRequestIdentity
  readonly nodeIds: ReadonlySet<string>
  readonly resolve: (result: LayoutResult) => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

export type LayoutWorkerFactory = () => Worker

export interface LayoutWorkerClientOptions {
  readonly requestTimeoutMs?: number
}

export class StaleLayoutRequestError extends Error {
  constructor(identity: LayoutRequestIdentity) {
    super(
      `Layout request ${identity.requestId} for editor session ${identity.editorSessionId}, project ${identity.projectId}, revision ${identity.graphRevision}, direction ${identity.direction} is stale.`,
    )
    this.name = 'StaleLayoutRequestError'
  }
}

export class LayoutProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayoutProtocolError'
  }
}

export class LayoutWorkerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Layout Worker did not respond within ${timeoutMs}ms.`)
    this.name = 'LayoutWorkerTimeoutError'
  }
}

function createLayoutWorker(): Worker {
  return new Worker(new URL('./layout.worker.ts', import.meta.url), {
    type: 'module',
    name: 'schema-layout',
  })
}

function scopeKey(identity: LayoutRequestIdentity): string {
  return `${identity.editorSessionId.length}:${identity.editorSessionId}${identity.projectId}`
}

function identityKey(identity: LayoutRequestIdentity): string {
  return JSON.stringify([
    identity.editorSessionId,
    identity.projectId,
    identity.graphRevision,
    identity.requestId,
    identity.direction,
  ])
}

function isOlderThan(
  candidate: LayoutRequestIdentity,
  latest: LayoutRequestIdentity,
): boolean {
  return (
    candidate.graphRevision < latest.graphRevision ||
    (candidate.graphRevision === latest.graphRevision &&
      candidate.requestId <= latest.requestId)
  )
}

function getRequestId(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const requestId = (value as Record<string, unknown>).requestId
  return Number.isSafeInteger(requestId) && (requestId as number) >= 0
    ? (requestId as number)
    : undefined
}

export function isLayoutResultCurrent(
  result: LayoutResult,
  expected: LayoutRequestIdentity,
): boolean {
  return hasSameLayoutIdentity(result, expected)
}

export class LayoutWorkerClient {
  readonly #workerFactory: LayoutWorkerFactory
  readonly #requestTimeoutMs: number
  readonly #pending = new Map<string, PendingLayoutRequest>()
  readonly #latestByScope = new Map<string, LayoutRequestIdentity>()
  #worker?: Worker
  #disposed = false

  constructor(
    workerFactory: LayoutWorkerFactory = createLayoutWorker,
    options: LayoutWorkerClientOptions = {},
  ) {
    this.#workerFactory = workerFactory
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 20_000
    if (!Number.isFinite(this.#requestTimeoutMs) || this.#requestTimeoutMs <= 0) {
      throw new Error('Layout Worker timeout must be a positive finite number.')
    }
    this.#ensureWorker()
  }

  layout(requestValue: LayoutRequest): Promise<LayoutResult> {
    if (this.#disposed) {
      return Promise.reject(new Error('Layout Worker has been disposed.'))
    }
    const validation = validateLayoutRequest(requestValue)
    if (!validation.ok) {
      return Promise.reject(new LayoutProtocolError(validation.error))
    }
    const request = validation.value
    const identity = getLayoutRequestIdentity(request)
    const key = scopeKey(identity)
    const pendingKey = identityKey(identity)
    const latest = this.#latestByScope.get(key)

    if (latest && isOlderThan(identity, latest)) {
      return Promise.reject(new StaleLayoutRequestError(identity))
    }
    if (this.#pending.has(pendingKey)) {
      return Promise.reject(
        new LayoutProtocolError(
          `Layout request ${request.requestId} is already pending for this identity.`,
        ),
      )
    }

    for (const [keyToDelete, pending] of this.#pending) {
      if (
        scopeKey(pending.identity) === key &&
        !isOlderThan(identity, pending.identity)
      ) {
        this.#rejectPending(
          keyToDelete,
          pending,
          new StaleLayoutRequestError(pending.identity),
        )
      }
    }
    this.#latestByScope.set(key, identity)

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.#pending.has(pendingKey)) return
        this.#failWorker(new LayoutWorkerTimeoutError(this.#requestTimeoutMs))
      }, this.#requestTimeoutMs)
      this.#pending.set(pendingKey, {
        identity,
        nodeIds: new Set(request.nodes.map((node) => node.id)),
        resolve,
        reject,
        timeout,
      })
      try {
        this.#ensureWorker().postMessage(request)
      } catch (error) {
        this.#failWorker(
          error instanceof Error ? error : new Error('Failed to post layout request.'),
        )
      }
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#destroyWorker()
    for (const [key, pending] of this.#pending) {
      this.#rejectPending(key, pending, new Error('Layout Worker has been disposed.'))
    }
    this.#latestByScope.clear()
  }

  #ensureWorker(): Worker {
    if (this.#disposed) throw new Error('Layout Worker has been disposed.')
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

  #rejectPending(key: string, pending: PendingLayoutRequest, error: Error): void {
    clearTimeout(pending.timeout)
    this.#pending.delete(key)
    pending.reject(error)
  }

  #failWorker(error: Error): void {
    this.#destroyWorker()
    for (const [key, pending] of this.#pending) {
      this.#rejectPending(key, pending, error)
    }
  }

  readonly #handleMessage = (event: MessageEvent<unknown>): void => {
    const validation = validateLayoutResult(event.data)
    if (!validation.ok) {
      const error = new LayoutProtocolError(
        `Invalid layout result: ${validation.error}`,
      )
      const requestId = getRequestId(event.data)
      const matchingRequests = [...this.#pending.entries()].filter(
        ([, pending]) => pending.identity.requestId === requestId,
      )
      if (requestId === undefined || !matchingRequests.length) {
        for (const [key, pending] of this.#pending) {
          this.#rejectPending(key, pending, error)
        }
      } else {
        for (const [keyToDelete, pending] of matchingRequests) {
          this.#rejectPending(keyToDelete, pending, error)
        }
      }
      return
    }

    const result = validation.value
    const resultKey = identityKey(result)
    const pending = this.#pending.get(resultKey)
    if (!pending) {
      const error = new LayoutProtocolError(
        `Layout result request ${result.requestId} does not match a pending request.`,
      )
      const sameRequestId = [...this.#pending.entries()].filter(
        ([, candidate]) => candidate.identity.requestId === result.requestId,
      )
      if (sameRequestId.length) {
        for (const [keyToDelete, candidate] of sameRequestId) {
          this.#rejectPending(keyToDelete, candidate, error)
        }
        return
      }

      const latest = this.#latestByScope.get(scopeKey(result))
      if (latest && isOlderThan(result, latest)) return

      const sameScope = [...this.#pending.entries()].filter(
        ([, candidate]) => scopeKey(candidate.identity) === scopeKey(result),
      )
      const affected = sameScope.length ? sameScope : [...this.#pending.entries()]
      for (const [keyToDelete, candidate] of affected) {
        this.#rejectPending(keyToDelete, candidate, error)
      }
      return
    }

    const latest = this.#latestByScope.get(scopeKey(result))
    if (!latest || !isLayoutResultCurrent(result, latest)) {
      this.#rejectPending(
        resultKey,
        pending,
        new StaleLayoutRequestError(pending.identity),
      )
      return
    }

    if (result.ok) {
      const resultIds = new Set(result.positions.map((position) => position.id))
      const hasExpectedPositions =
        resultIds.size === pending.nodeIds.size &&
        [...pending.nodeIds].every((id) => resultIds.has(id))
      if (!hasExpectedPositions) {
        this.#rejectPending(
          resultKey,
          pending,
          new LayoutProtocolError(
            `Layout result positions do not match request ${result.requestId}.`,
          ),
        )
        return
      }
    }

    clearTimeout(pending.timeout)
    this.#pending.delete(resultKey)
    pending.resolve(result)
  }

  readonly #handleError = (event: ErrorEvent): void => {
    this.#failWorker(new Error(event.message || 'Layout Worker failed.'))
  }

  readonly #handleMessageError = (): void => {
    this.#failWorker(new Error('Layout Worker returned an unreadable message.'))
  }
}
