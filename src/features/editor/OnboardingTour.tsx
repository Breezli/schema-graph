import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { useEditorStore } from '@/state'

const tourSteps = [
  {
    selector: '.structure-rail',
    title: '从项目结构开始',
    description:
      '切换文件或点击模型名称。点击模型会在不改变缩放的情况下，把画布平移到对应节点。',
  },
  {
    selector: '.monaco-shell',
    title: '代码和图始终同步',
    description:
      '修改 Prisma Schema 后会在 Worker 中重新解析。选中的模型、字段和关系会自动定位并高亮源码。',
  },
  {
    selector: '.canvas-panel',
    title: '移动、缩放和布局',
    description:
      '拖动空白处平移，滚轮缩放，框选多个节点。图表更新会保留你当前的视口和缩放。',
  },
  {
    selector: '.schema-node',
    fallbackSelector: '.canvas-panel',
    title: '编辑模型和字段',
    description:
      '点击模型打开属性面板，点击字段联动源码；字段右侧连接点可以拖向另一个模型创建关系。',
  },
  {
    selector: '.inspector-panel',
    title: '阅读和创建关系',
    description:
      '关系页可以创建一对多关系。关系线端点展示基数，箭头只表示外键指向，不表示数据流。',
  },
  {
    selector: '.project-title',
    title: '错误不会清空画布',
    description:
      '代码无效时会保留最后一次有效结构并暂停结构编辑。修复代码后，画布会继续同步。',
  },
  {
    selector: '.workspace-export',
    title: '本地保存与导出',
    description:
      '项目会自动保存到 IndexedDB。右上角可以复制 Schema，单文件直接下载，多文件自动打包 ZIP。',
  },
] as const

interface SpotlightRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
  readonly bottom: number
  readonly right: number
}

export function OnboardingTour() {
  const open = useEditorStore((state) => state.tourOpen)
  const step = useEditorStore((state) => state.tourStep)
  const closeTour = useEditorStore((state) => state.closeTour)
  const nextTourStep = useEditorStore((state) => state.nextTourStep)
  const previousTourStep = useEditorStore((state) => state.previousTourStep)
  const [rect, setRect] = useState<SpotlightRect | null>(null)
  const current = tourSteps[step] ?? tourSteps[0]

  useEffect(() => {
    if (!open) return
    let frame = 0
    const update = (): void => {
      const target =
        document.querySelector<HTMLElement>(current.selector) ??
        ('fallbackSelector' in current
          ? document.querySelector<HTMLElement>(current.fallbackSelector)
          : null)
      if (!target) {
        setRect(null)
        return
      }
      const bounds = target.getBoundingClientRect()
      setRect({
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
        bottom: bounds.bottom,
        right: bounds.right,
      })
    }
    frame = window.requestAnimationFrame(update)
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(update)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [current, open])

  const cardPosition = useMemo(() => {
    if (!rect || typeof window === 'undefined') {
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
    }
    const cardWidth = Math.min(340, window.innerWidth - 32)
    const left = Math.min(
      Math.max(16, rect.left),
      Math.max(16, window.innerWidth - cardWidth - 16),
    )
    const placeBelow = rect.bottom + 220 < window.innerHeight
    return {
      left,
      top: placeBelow ? rect.bottom + 14 : Math.max(16, rect.top - 204),
    }
  }, [rect])

  if (!open) return null

  return createPortal(
    <div className="tour-layer" aria-live="polite">
      {rect && (
        <div
          className="tour-spotlight"
          style={{
            top: Math.max(6, rect.top - 6),
            left: Math.max(6, rect.left - 6),
            width: Math.min(window.innerWidth - 12, rect.width + 12),
            height: Math.min(window.innerHeight - 12, rect.height + 12),
          }}
        />
      )}
      <section className="tour-card" style={cardPosition} aria-label="新手指引">
        <div className="tour-card-head">
          <span>
            {String(step + 1).padStart(2, '0')} /{' '}
            {String(tourSteps.length).padStart(2, '0')}
          </span>
          <button type="button" onClick={closeTour} aria-label="关闭新手指引">
            <X size={15} />
          </button>
        </div>
        <h2>{current.title}</h2>
        <p>{current.description}</p>
        <div className="tour-progress" aria-hidden="true">
          {tourSteps.map((_, index) => (
            <i key={index} className={index <= step ? 'is-active' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="tour-skip" type="button" onClick={closeTour}>
            跳过指引
          </button>
          <div>
            <button
              type="button"
              onClick={previousTourStep}
              disabled={step === 0}
              aria-label="上一步"
            >
              <ArrowLeft size={14} />
            </button>
            <button className="tour-next" type="button" onClick={nextTourStep}>
              {step === tourSteps.length - 1 ? '完成' : '下一步'}
              {step < tourSteps.length - 1 && <ArrowRight size={14} />}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
