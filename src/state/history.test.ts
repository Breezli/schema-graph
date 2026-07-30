import { describe, expect, it } from 'vitest'

import { commitHistory, createHistory, redoHistory, undoHistory } from './history'

describe('unified session history', () => {
  it('coalesces consecutive source edits and keeps graph edits separate', () => {
    let history = createHistory({ source: 'a', nodes: 1 })
    history = commitHistory(
      history,
      { source: 'ab', nodes: 1 },
      { coalesceKey: 'code:a' },
    )
    history = commitHistory(
      history,
      { source: 'abc', nodes: 1 },
      { coalesceKey: 'code:a' },
    )
    history = commitHistory(
      history,
      { source: 'abc', nodes: 2 },
      { coalesceKey: 'graph' },
    )

    expect(history.past).toHaveLength(2)
    history = undoHistory(history)
    expect(history.present).toEqual({ source: 'abc', nodes: 1 })
    history = undoHistory(history)
    expect(history.present).toEqual({ source: 'a', nodes: 1 })
    history = redoHistory(history)
    expect(history.present).toEqual({ source: 'abc', nodes: 1 })
  })

  it('respects its memory bound', () => {
    let history = createHistory(0, 2)
    history = commitHistory(history, 1)
    history = commitHistory(history, 2)
    history = commitHistory(history, 3)

    expect(history.past).toEqual([1, 2])
  })
})
