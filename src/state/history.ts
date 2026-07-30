export interface HistoryState<T> {
  readonly present: T
  readonly past: readonly T[]
  readonly future: readonly T[]
  readonly limit: number
  readonly coalesceKey?: string
}

export function createHistory<T>(initial: T, limit = 100): HistoryState<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('历史记录上限必须是正整数。')
  }
  return { present: initial, past: [], future: [], limit }
}

export interface CommitHistoryOptions {
  readonly coalesceKey?: string
}

export function commitHistory<T>(
  history: HistoryState<T>,
  next: T,
  options: CommitHistoryOptions = {},
): HistoryState<T> {
  if (Object.is(history.present, next)) return history

  const shouldCoalesce =
    options.coalesceKey !== undefined &&
    options.coalesceKey === history.coalesceKey &&
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
  }
}
