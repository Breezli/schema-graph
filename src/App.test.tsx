import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import App from './App'

describe('App', () => {
  it('renders the Schema Graph project entry', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { name: '给 Prisma Schema 一张可以编辑的地图。' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /新建本地项目/ })).toBeTruthy()
  })
})
