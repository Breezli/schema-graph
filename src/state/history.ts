export interface HistoryState<T> {
  readonly present: T
  readonly past: readonly T[]
  readonly future: readonly T[]
  readonly limit: number
  readonly coalesceKey?: string
  readonly coalesceStartedAt?: number
}

export const DEFAULT_HISTORY_COALESCE_WINDOW_MS = 750

export function createHistory<T>(initial: T, limit = 100): HistoryState<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('历史记录上限必须是正整数。')
  }
  return { present: initial, past: [], future: [], limit }
}

export interface CommitHistoryOptions {
  readonly coalesceKey?: string
  readonly timestamp?: number
  readonly coalesceWindowMs?: number
}

export function commitHistory<T>(
  history: HistoryState<T>,
  next: T,
  options: CommitHistoryOptions = {},
): HistoryState<T> {
  if (Object.is(history.present, next)) return history

  const timestamp = options.timestamp ?? Date.now()
  const coalesceWindowMs =
    options.coalesceWindowMs ?? DEFAULT_HISTORY_COALESCE_WINDOW_MS
  if (!Number.isFinite(timestamp)) throw new Error('历史时间戳必须是有限数值。')
  if (!Number.isFinite(coalesceWindowMs) || coalesceWindowMs < 0) {
    throw new Error('历史合并窗口必须是非负有限数值。')
  }
  const shouldCoalesce =
    options.coalesceKey !== undefined &&
    options.coalesceKey === history.coalesceKey &&
    history.coalesceStartedAt !== undefined &&
    timestamp >= history.coalesceStartedAt &&
    timestamp - history.coalesceStartedAt <= coalesceWindowMs &&
    history.future.length === 0
  const past = shouldCoalesce
    ? history.past
    : [...history.past, history.present].slice(-history.limit)

  return {
    ...history,
    present: next,
    past,
    future: [],
    coalesceKey: options.coalesceKey,
    coalesceStartedAt:
      options.coalesceKey === undefined
        ? undefined
        : shouldCoalesce
          ? history.coalesceStartedAt
          : timestamp,
  }
}

export function canUndoHistory<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0
}

export function canRedoHistory<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0
}

export function breakHistoryCoalescence<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.coalesceKey === undefined && history.coalesceStartedAt === undefined) {
    return history
  }
  return {
    ...history,
    coalesceKey: undefined,
    coalesceStartedAt: undefined,
  }
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const previous = history.past.at(-1)
  if (previous === undefined) return history
  return {
    ...history,
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
    coalesceKey: undefined,
    coalesceStartedAt: undefined,
  }
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  const next = history.future[0]
  if (next === undefined) return history
  return {
    ...history,
    present: next,
    past: [...history.past, history.present].slice(-history.limit),
    future: history.future.slice(1),
    coalesceKey: undefined,
    coalesceStartedAt: undefined,
  }
}
