import { describe, expect, it } from 'vitest'

import { commitHistory, createHistory, redoHistory, undoHistory } from './history'

describe('unified session history', () => {
  it('coalesces consecutive source edits within the window and keeps graph edits separate', () => {
    let history = createHistory({ source: 'a', nodes: 1 })
    history = commitHistory(
      history,
      { source: 'ab', nodes: 1 },
      { coalesceKey: 'code:a', timestamp: 100 },
    )
    history = commitHistory(
      history,
      { source: 'abc', nodes: 1 },
      { coalesceKey: 'code:a', timestamp: 200 },
    )
    history = commitHistory(
      history,
      { source: 'abc', nodes: 2 },
      { coalesceKey: 'graph', timestamp: 250 },
    )

    expect(history.past).toHaveLength(2)
    history = undoHistory(history)
    expect(history.present).toEqual({ source: 'abc', nodes: 1 })
    history = undoHistory(history)
    expect(history.present).toEqual({ source: 'a', nodes: 1 })
    history = redoHistory(history)
    expect(history.present).toEqual({ source: 'abc', nodes: 1 })
  })

  it('starts a new undo group after the coalescing window', () => {
    let history = createHistory('a')
    history = commitHistory(history, 'ab', {
      coalesceKey: 'code:file-a',
      timestamp: 1_000,
      coalesceWindowMs: 500,
    })
    history = commitHistory(history, 'abc', {
      coalesceKey: 'code:file-a',
      timestamp: 1_500,
      coalesceWindowMs: 500,
    })
    history = commitHistory(history, 'abcd', {
      coalesceKey: 'code:file-a',
      timestamp: 2_001,
      coalesceWindowMs: 500,
    })

    expect(history.past).toEqual(['a', 'abc'])
    history = undoHistory(history)
    expect(history.present).toBe('abc')
    history = undoHistory(history)
    expect(history.present).toBe('a')
  })

  it('uses file-specific keys as deterministic typing boundaries', () => {
    let history = createHistory('initial')
    history = commitHistory(history, 'file-a edit', {
      coalesceKey: 'code:file-a',
      timestamp: 100,
    })
    history = commitHistory(history, 'file-b edit', {
      coalesceKey: 'code:file-b',
      timestamp: 150,
    })
    history = commitHistory(history, 'file-a again', {
      coalesceKey: 'code:file-a',
      timestamp: 200,
    })

    expect(history.past).toEqual(['initial', 'file-a edit', 'file-b edit'])
  })

  it('respects its memory bound', () => {
    let history = createHistory(0, 2)
    history = commitHistory(history, 1)
    history = commitHistory(history, 2)
    history = commitHistory(history, 3)

    expect(history.past).toEqual([1, 2])
  })
})
