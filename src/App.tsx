import { Toaster } from 'sonner'
import { lazy, Suspense } from 'react'

import { ProjectHome } from '@/features/projects/ProjectHome'
import { useEditorStore } from '@/state'

const Workspace = lazy(async () => {
  const module = await import('@/features/editor')
  return { default: module.Workspace }
})

export default function App() {
  const view = useEditorStore((state) => state.view)
  const theme = useEditorStore((state) => state.theme)

  return (
    <>
      {view === 'home' ? (
        <ProjectHome />
      ) : (
        <Suspense
          fallback={<div className="workspace-loading">正在打开结构工作台…</div>}
        >
          <Workspace />
        </Suspense>
      )}
      <Toaster
        position="bottom-right"
        theme={theme}
        richColors={false}
        closeButton
        toastOptions={{ className: 'schema-toast' }}
      />
    </>
  )
}
