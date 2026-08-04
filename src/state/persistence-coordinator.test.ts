import { describe, expect, it, vi } from 'vitest'

import { ProjectPersistenceCoordinator } from './persistence-coordinator'

interface Snapshot {
  readonly projectId: string
  readonly content: string
}

describe('project persistence coordinator', () => {
  it('retains failed A across B success and retries A later', async () => {
    const save = vi
      .fn<(snapshot: Snapshot) => Promise<void>>()
      .mockRejectedValueOnce(new Error('A unavailable'))
      .mockResolvedValue(undefined)
    const coordinator = new ProjectPersistenceCoordinator({ save })

    coordinator.enqueue({
      projectId: 'A',
      value: { projectId: 'A', content: 'a1' },
    })
    await coordinator.drainQueued()
    coordinator.enqueue({
      projectId: 'B',
      value: { projectId: 'B', content: 'b1' },
    })
    await coordinator.drainQueued()

    expect(save.mock.calls.map(([snapshot]) => snapshot.projectId)).toEqual(['A', 'B'])
    await coordinator.flush()
    expect(save.mock.calls.map(([snapshot]) => snapshot.projectId)).toEqual([
      'A',
      'B',
      'A',
    ])
  })

  it('tombstones queued and failed saves so delete cannot be undone by retry', async () => {
    const save = vi
      .fn<(snapshot: Snapshot) => Promise<void>>()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValue(undefined)
    const coordinator = new ProjectPersistenceCoordinator({ save })

    coordinator.enqueue({
      projectId: 'A',
      value: { projectId: 'A', content: 'failed' },
    })
    await expect(coordinator.flush()).rejects.toThrow('write failed')

    coordinator.enqueue({
      projectId: 'A',
      value: { projectId: 'A', content: 'queued' },
    })
    coordinator.tombstone('A')
    await coordinator.settleProject('A')
    await coordinator.flush()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('supersedes a failed snapshot only with a newer snapshot from that project', async () => {
    const save = vi
      .fn<(snapshot: Snapshot) => Promise<void>>()
      .mockRejectedValueOnce(new Error('old A failed'))
      .mockResolvedValue(undefined)
    const coordinator = new ProjectPersistenceCoordinator({ save })

    coordinator.enqueue({
      projectId: 'A',
      value: { projectId: 'A', content: 'old' },
    })
    await coordinator.drainQueued()
    coordinator.enqueue({
      projectId: 'A',
      value: { projectId: 'A', content: 'new' },
    })
    await coordinator.flush()

    expect(save.mock.calls.map(([snapshot]) => snapshot.content)).toEqual([
      'old',
      'new',
    ])
  })
})
