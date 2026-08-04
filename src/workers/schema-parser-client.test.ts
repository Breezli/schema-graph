import { afterEach, describe, expect, it, vi } from 'vitest'

import { createVirtualSchemaFile } from '@/domain/schema'

import {
  SchemaParserWorkerClient,
  SchemaParserWorkerTimeoutError,
} from './schema-parser-client'
import type {
  SchemaParserWorkerRequest,
  SchemaParserWorkerResponse,
} from './schema-parser-protocol'

class FakeWorker {
  readonly requests: SchemaParserWorkerRequest[] = []
  readonly listeners = new Map<string, EventListener>()

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, listener)
  }

  terminated = false

  removeEventListener(type: string): void {
    this.listeners.delete(type)
  }
  terminate(): void {
    this.terminated = true
  }

  postMessage(request: SchemaParserWorkerRequest): void {
    this.requests.push(request)
  }

  respond(response: SchemaParserWorkerResponse): void {
    this.listeners.get('message')?.({ data: response } as unknown as Event)
  }

  fail(message: string): void {
    this.listeners.get('error')?.({ message } as unknown as Event)
  }
}

describe('schema parser worker client', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keys pending requests by session and revision and rejects prior sessions', async () => {
    const worker = new FakeWorker()
    const client = new SchemaParserWorkerClient(() => worker as unknown as Worker)
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}')]
    const first = client.parse(
      { editorSessionId: 1, projectId: 'same-project', revision: 1 },
      files,
    )
    const reopened = client.parse(
      { editorSessionId: 2, projectId: 'same-project', revision: 1 },
      files,
    )

    await expect(first).rejects.toThrow('新的项目会话取代')
    const request = worker.requests.at(-1)
    if (!request) throw new Error('Missing parser request')
    const response: SchemaParserWorkerResponse = {
      protocolVersion: request.protocolVersion,
      kind: 'parse-schema-project-result',
      editorSessionId: request.editorSessionId,
      projectId: request.projectId,
      revision: request.revision,
      result: { valid: false, revision: request.revision, diagnostics: [] },
    }
    worker.respond({ ...response, editorSessionId: 1 })
    worker.respond(response)

    await expect(reopened).resolves.toEqual(response)
    client.dispose()
  })

  it('rejects an older revision only within the active session', async () => {
    const worker = new FakeWorker()
    const client = new SchemaParserWorkerClient(() => worker as unknown as Worker)
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}')]
    const stale = client.parse(
      { editorSessionId: 3, projectId: 'project-a', revision: 1 },
      files,
    )
    const latest = client.parse(
      { editorSessionId: 3, projectId: 'project-a', revision: 2 },
      files,
    )

    await expect(stale).rejects.toThrow('更新版本取代')
    client.dispose()
    await expect(latest).rejects.toThrow('已关闭')
  })

  it('times out all pending work, terminates the worker and recovers later', async () => {
    vi.useFakeTimers()
    const workers: FakeWorker[] = []
    const client = new SchemaParserWorkerClient(
      () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker as unknown as Worker
      },
      { requestTimeoutMs: 50 },
    )
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}')]
    const timedOut = client.parse(
      { editorSessionId: 5, projectId: 'project-a', revision: 1 },
      files,
    )
    const alsoTimedOut = client.parse(
      { editorSessionId: 5, projectId: 'project-b', revision: 1 },
      files,
    )
    const timedOutExpectation = expect(timedOut).rejects.toBeInstanceOf(
      SchemaParserWorkerTimeoutError,
    )
    const alsoTimedOutExpectation = expect(alsoTimedOut).rejects.toBeInstanceOf(
      SchemaParserWorkerTimeoutError,
    )

    await vi.advanceTimersByTimeAsync(50)
    await timedOutExpectation
    await alsoTimedOutExpectation
    expect(workers[0]?.terminated).toBe(true)

    const recovered = client.parse(
      { editorSessionId: 5, projectId: 'project-a', revision: 2 },
      files,
    )
    const request = workers[1]?.requests[0]
    if (!request) throw new Error('Missing recovered parser request')
    const response: SchemaParserWorkerResponse = {
      protocolVersion: request.protocolVersion,
      kind: 'parse-schema-project-result',
      editorSessionId: request.editorSessionId,
      projectId: request.projectId,
      revision: request.revision,
      result: { valid: false, revision: request.revision, diagnostics: [] },
    }
    workers[1]?.respond(response)

    await expect(recovered).resolves.toEqual(response)
    client.dispose()
  })

  it('rejects pending work on fatal error and recreates for the next call', async () => {
    const workers: FakeWorker[] = []
    const client = new SchemaParserWorkerClient(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    })
    const files = [createVirtualSchemaFile('schema.prisma', 'model User {}')]
    const failed = client.parse(
      { editorSessionId: 6, projectId: 'project-a', revision: 1 },
      files,
    )
    workers[0]?.fail('parser crashed')

    await expect(failed).rejects.toThrow('parser crashed')
    expect(workers[0]?.terminated).toBe(true)

    const recovered = client.parse(
      { editorSessionId: 6, projectId: 'project-a', revision: 2 },
      files,
    )
    expect(workers).toHaveLength(2)
    client.dispose()
    await expect(recovered).rejects.toThrow('已关闭')
  })
})
