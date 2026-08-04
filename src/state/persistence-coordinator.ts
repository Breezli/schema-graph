export interface ProjectPersistenceSnapshot<T> {
  readonly projectId: string
  readonly value: T
}

export interface ProjectPersistenceCoordinatorOptions<T> {
  readonly save: (value: T) => Promise<void>
  readonly onFailure?: (projectId: string, error: Error) => void
}

interface PersistenceTask<T> {
  readonly projectId: string
  readonly revision: number
  readonly value: T
  readonly settled: Promise<void>
  readonly resolveSettled: () => void
  error?: Error
}

interface ProjectQueue<T> {
  deleted: boolean
  pending?: PersistenceTask<T>
  inFlight?: PersistenceTask<T>
  failed?: PersistenceTask<T>
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Serializes persistence while retaining failure and supersession state per project.
 * Scheduled drains attempt only newly queued work; explicit flushes also retry failures.
 */
export class ProjectPersistenceCoordinator<T> {
  readonly #save: (value: T) => Promise<void>
  readonly #onFailure?: (projectId: string, error: Error) => void
  readonly #projects = new Map<string, ProjectQueue<T>>()
  readonly #queue: PersistenceTask<T>[] = []
  #nextRevision = 0
  #drainPromise?: Promise<void>

  constructor(options: ProjectPersistenceCoordinatorOptions<T>) {
    this.#save = options.save
    this.#onFailure = options.onFailure
  }

  enqueue(snapshot: ProjectPersistenceSnapshot<T>): Promise<void> {
    const state = this.#project(snapshot.projectId)
    if (state.deleted) return Promise.resolve()

    let resolveSettled = (): void => {}
    const settled = new Promise<void>((resolve) => {
      resolveSettled = resolve
    })
    const task: PersistenceTask<T> = {
      projectId: snapshot.projectId,
      revision: ++this.#nextRevision,
      value: snapshot.value,
      settled,
      resolveSettled,
    }

    if (state.pending) {
      this.#removeQueuedTask(state.pending)
      state.pending.resolveSettled()
    }
    if (state.failed && state.failed.revision < task.revision) {
      state.failed = undefined
    }
    state.pending = task
    this.#queue.push(task)
    return settled
  }

  /** Attempts queued snapshots without automatically retrying prior failures. */
  drainQueued(): Promise<void> {
    if (this.#drainPromise) return this.#drainPromise
    const operation = this.#drain()
    const wrapped = operation.finally(() => {
      if (this.#drainPromise === wrapped) this.#drainPromise = undefined
    })
    this.#drainPromise = wrapped
    return wrapped
  }

  /** Retries failed snapshots, then waits for every currently queued save. */
  async flush(): Promise<void> {
    this.#requeueFailures()
    await this.drainQueued()

    const failure = [...this.#projects.values()]
      .map((state) => state.failed)
      .filter((task): task is PersistenceTask<T> => task !== undefined)
      .sort((left, right) => left.revision - right.revision)[0]
    if (failure) throw failure.error ?? new Error('Project persistence failed.')
  }

  /**
   * Prevents queued or failed saves from recreating a deleted project. In-flight work
   * is ignored on completion and can be awaited before deleting the durable record.
   */
  tombstone(projectId: string): void {
    const state = this.#project(projectId)
    state.deleted = true
    if (state.pending) {
      this.#removeQueuedTask(state.pending)
      state.pending.resolveSettled()
      state.pending = undefined
    }
    state.failed = undefined
  }

  async settleProject(projectId: string): Promise<void> {
    while (this.#projects.get(projectId)?.inFlight) {
      await this.drainQueued()
    }
  }

  reset(): void {
    for (const state of this.#projects.values()) {
      state.deleted = true
      state.pending?.resolveSettled()
      state.pending = undefined
      state.failed = undefined
    }
    this.#projects.clear()
    this.#queue.length = 0
    this.#nextRevision = 0
  }

  #project(projectId: string): ProjectQueue<T> {
    let state = this.#projects.get(projectId)
    if (!state) {
      state = { deleted: false }
      this.#projects.set(projectId, state)
    }
    return state
  }

  #removeQueuedTask(task: PersistenceTask<T>): void {
    const index = this.#queue.indexOf(task)
    if (index >= 0) this.#queue.splice(index, 1)
  }

  #requeueFailures(): void {
    const retries: PersistenceTask<T>[] = []
    for (const state of this.#projects.values()) {
      const failed = state.failed
      if (state.deleted || !failed || state.pending) continue
      state.failed = undefined
      state.pending = failed
      retries.push(failed)
    }
    this.#queue.push(...retries)
    this.#queue.sort((left, right) => left.revision - right.revision)
  }

  async #drain(): Promise<void> {
    while (this.#queue.length) {
      const task = this.#queue.shift()
      if (!task) continue
      const state = this.#projects.get(task.projectId)
      if (!state || state.deleted || state.pending !== task) {
        task.resolveSettled()
        continue
      }

      state.pending = undefined
      state.inFlight = task
      try {
        await this.#save(task.value)
      } catch (error) {
        const failure = asError(error)
        task.error = failure
        const newerPending = state.pending as PersistenceTask<T> | undefined
        if (
          !state.deleted &&
          (!newerPending || newerPending.revision <= task.revision)
        ) {
          state.failed = task
          this.#onFailure?.(task.projectId, failure)
        }
      } finally {
        if (state.inFlight === task) state.inFlight = undefined
        task.resolveSettled()
      }
    }
  }
}
