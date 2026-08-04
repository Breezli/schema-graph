import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isLayoutResultCurrent,
  LayoutProtocolError,
  LayoutWorkerClient,
  LayoutWorkerTimeoutError,
  StaleLayoutRequestError,
} from './layout-client'
import {
  createLayoutRequest,
  LAYOUT_PROTOCOL_VERSION,
  LAYOUT_RESULT_KIND,
  type LayoutRequest,
  type LayoutResult,
} from './layout-protocol'

class FakeWorker extends EventTarget {
  readonly requests: LayoutRequest[] = []
  terminated = false

  postMessage(request: LayoutRequest): void {
    this.requests.push(request)
  }

  terminate(): void {
    this.terminated = true
  }

  respond(result: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: result }))
  }

  fail(message: string): void {
    const event = new Event('error') as ErrorEvent
    Object.defineProperty(event, 'message', { value: message })
    this.dispatchEvent(event)
  }
}

function request(
  requestId: number,
  graphRevision: number,
  projectId = 'project-1',
  direction: LayoutRequest['direction'] = 'RIGHT',
  editorSessionId = 'editor-session-1',
): LayoutRequest {
  return createLayoutRequest({
    editorSessionId,
    requestId,
    projectId,
    graphRevision,
    direction,
    nodes: [],
    hierarchyEdges: [],
  })
}

function success(layoutRequest: LayoutRequest): LayoutResult {
  return {
    protocolVersion: LAYOUT_PROTOCOL_VERSION,
    kind: LAYOUT_RESULT_KIND,
    editorSessionId: layoutRequest.editorSessionId,
    requestId: layoutRequest.requestId,
    projectId: layoutRequest.projectId,
    graphRevision: layoutRequest.graphRevision,
    direction: layoutRequest.direction,
    ok: true,
    positions: [],
  }
}

describe('layout worker client freshness', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects a superseded revision and resolves the latest response', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const oldRequest = request(1, 1)
    const latestRequest = request(2, 2)
    const oldPromise = client.layout(oldRequest)
    const latestPromise = client.layout(latestRequest)

    await expect(oldPromise).rejects.toBeInstanceOf(StaleLayoutRequestError)
    worker.respond(success(oldRequest))
    worker.respond(success(latestRequest))
    await expect(latestPromise).resolves.toEqual(success(latestRequest))
    client.dispose()
  })

  it('rejects identity-mismatched responses immediately', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const layoutRequest = request(3, 4, 'project-a', 'DOWN')
    const promise = client.layout(layoutRequest)

    worker.respond({ ...success(layoutRequest), projectId: 'project-b' })

    await expect(promise).rejects.toBeInstanceOf(LayoutProtocolError)
    client.dispose()
  })

  it('rejects a non-stale response with a mismatched request id', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const layoutRequest = request(20, 4)
    const promise = client.layout(layoutRequest)

    worker.respond({ ...success(layoutRequest), requestId: 21 })

    await expect(promise).rejects.toBeInstanceOf(LayoutProtocolError)
    client.dispose()
  })

  it('rejects malformed responses instead of leaving requests pending', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const layoutRequest = request(30, 4)
    const promise = client.layout(layoutRequest)

    worker.respond({
      ...success(layoutRequest),
      protocolVersion: LAYOUT_PROTOCOL_VERSION + 1,
    })

    await expect(promise).rejects.toBeInstanceOf(LayoutProtocolError)
    client.dispose()
  })

  it('rejects malformed responses without identity for all pending requests', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const firstPromise = client.layout(request(31, 1, 'project-a'))
    const secondPromise = client.layout(request(32, 1, 'project-b'))

    worker.respond({ kind: LAYOUT_RESULT_KIND })

    await expect(firstPromise).rejects.toBeInstanceOf(LayoutProtocolError)
    await expect(secondPromise).rejects.toBeInstanceOf(LayoutProtocolError)
    client.dispose()
  })

  it('tracks projects independently and rejects older future calls', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const firstProject = request(4, 8, 'project-a')
    const secondProject = request(5, 1, 'project-b')
    const firstPromise = client.layout(firstProject)
    const secondPromise = client.layout(secondProject)

    worker.respond(success(secondProject))
    worker.respond(success(firstProject))
    await expect(firstPromise).resolves.toEqual(success(firstProject))
    await expect(secondPromise).resolves.toEqual(success(secondProject))
    await expect(client.layout(request(6, 7, 'project-a'))).rejects.toBeInstanceOf(
      StaleLayoutRequestError,
    )
    client.dispose()
  })

  it('supersedes a same-revision request when direction changes', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const right = request(7, 9, 'project-a', 'RIGHT')
    const down = request(8, 9, 'project-a', 'DOWN')
    const rightPromise = client.layout(right)
    const downPromise = client.layout(down)

    await expect(rightPromise).rejects.toBeInstanceOf(StaleLayoutRequestError)
    worker.respond(success(right))
    worker.respond(success(down))
    await expect(downPromise).resolves.toEqual(success(down))
    client.dispose()
  })

  it('tracks editor sessions independently for the same project', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const firstSession = request(40, 5, 'project-a', 'RIGHT', 'session-a')
    const secondSession = request(40, 1, 'project-a', 'RIGHT', 'session-b')
    const firstPromise = client.layout(firstSession)
    const secondPromise = client.layout(secondSession)

    worker.respond(success(secondSession))
    worker.respond(success(firstSession))

    await expect(firstPromise).resolves.toEqual(success(firstSession))
    await expect(secondPromise).resolves.toEqual(success(secondSession))
    client.dispose()
  })

  it('rejects an older request id at the current revision deterministically', async () => {
    const worker = new FakeWorker()
    const client = new LayoutWorkerClient(() => worker as unknown as Worker)
    const latest = request(50, 5)
    const latestPromise = client.layout(latest)
    worker.respond(success(latest))
    await expect(latestPromise).resolves.toEqual(success(latest))

    await expect(client.layout(request(49, 5))).rejects.toBeInstanceOf(
      StaleLayoutRequestError,
    )
    client.dispose()
  })

  it('compares the complete response identity', () => {
    const expected = request(9, 10, 'project-a', 'DOWN')
    expect(isLayoutResultCurrent(success(expected), expected)).toBe(true)
    expect(
      isLayoutResultCurrent({ ...success(expected), requestId: 10 }, expected),
    ).toBe(false)
  })

  it('times out pending work, terminates the worker and recovers later', async () => {
    vi.useFakeTimers()
    const workers: FakeWorker[] = []
    const client = new LayoutWorkerClient(
      () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker as unknown as Worker
      },
      { requestTimeoutMs: 40 },
    )
    const timedOut = client.layout(request(60, 1))
    const alsoTimedOut = client.layout(request(62, 1, 'project-2'))
    const timedOutExpectation = expect(timedOut).rejects.toBeInstanceOf(
      LayoutWorkerTimeoutError,
    )
    const alsoTimedOutExpectation = expect(alsoTimedOut).rejects.toBeInstanceOf(
      LayoutWorkerTimeoutError,
    )

    await vi.advanceTimersByTimeAsync(40)
    await timedOutExpectation
    await alsoTimedOutExpectation
    expect(workers[0]?.terminated).toBe(true)

    const nextRequest = request(61, 2)
    const recovered = client.layout(nextRequest)
    workers[1]?.respond(success(nextRequest))
    await expect(recovered).resolves.toEqual(success(nextRequest))
    client.dispose()
  })

  it('rejects pending work on fatal error and recreates for later calls', async () => {
    const workers: FakeWorker[] = []
    const client = new LayoutWorkerClient(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    })
    const failed = client.layout(request(70, 1))
    workers[0]?.fail('layout crashed')

    await expect(failed).rejects.toThrow('layout crashed')
    expect(workers[0]?.terminated).toBe(true)

    const nextRequest = request(71, 2)
    const recovered = client.layout(nextRequest)
    expect(workers).toHaveLength(2)
    workers[1]?.respond(success(nextRequest))
    await expect(recovered).resolves.toEqual(success(nextRequest))
    client.dispose()
  })
})
