import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  Download,
  LayoutGrid,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Sun,
  Undo2,
} from 'lucide-react'
import { Dialog, DropdownMenu } from 'radix-ui'
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from 'react'
import { toast } from 'sonner'

import { buildCombinedSchema, downloadSchemaProject } from '@/platform'
import { useEditorStore } from '@/state'

import { CodePanel } from './CodePanel'
import { InspectorPanel } from './InspectorPanel'
import { OnboardingTour } from './OnboardingTour'
import { SchemaCanvas } from './SchemaCanvas'

const NARROW_WORKSPACE_QUERY = '(max-width: 860px)'

function AddModelDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const files = useEditorStore((state) => state.history.present.files)
  const activeFilePath = useEditorStore((state) => state.activeFilePath)
  const addModel = useEditorStore((state) => state.addModel)
  const [name, setName] = useState('NewModel')
  const [filePath, setFilePath] = useState(activeFilePath ?? files[0]?.path ?? '')
  const selectedFilePath = files.some((file) => file.path === filePath)
    ? filePath
    : (activeFilePath ?? files[0]?.path ?? '')

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    addModel(name, selectedFilePath)
    onOpenChange(false)
    setName('NewModel')
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content compact-dialog">
          <Dialog.Title>新增模型</Dialog.Title>
          <Dialog.Description>
            创建后会立即写回对应的 Prisma Schema 文件。
          </Dialog.Description>
          <form onSubmit={submit}>
            <label htmlFor="new-model-name">模型名称</label>
            <input
              id="new-model-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label htmlFor="new-model-file">保存到文件</label>
            <select
              id="new-model-file"
              value={selectedFilePath}
              onChange={(event) => setFilePath(event.target.value)}
            >
              {files.map((file) => (
                <option key={file.path} value={file.path}>
                  {file.path}
                </option>
              ))}
            </select>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button className="button button-ghost" type="button">
                  取消
                </button>
              </Dialog.Close>
              <button className="button button-primary" type="submit">
                创建模型
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function LayoutDirectionDialog() {
  const open = useEditorStore((state) => state.layoutPromptOpen)
  const confirm = useEditorStore((state) => state.confirmLayoutDirection)

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content direction-dialog">
          <div className="dialog-icon">
            <LayoutGrid size={18} />
          </div>
          <Dialog.Title>关系图从哪个方向展开？</Dialog.Title>
          <Dialog.Description>
            这里只决定首次布局；之后可以随时拖动节点或重新布局。
          </Dialog.Description>
          <div className="direction-options">
            <button type="button" onClick={() => confirm('RIGHT')}>
              <span className="direction-preview horizontal">
                <i /> <b /> <i />
              </span>
              <strong>从左到右</strong>
              <small>适合宽屏与关系链</small>
            </button>
            <button type="button" onClick={() => confirm('DOWN')}>
              <span className="direction-preview vertical">
                <i /> <b /> <i />
              </span>
              <strong>从上到下</strong>
              <small>适合层级和流程</small>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ResizeHandle({
  side,
  value,
  min,
  max,
  onResize,
}: {
  readonly side: 'left' | 'right'
  readonly value: number
  readonly min: number
  readonly max: number
  readonly onResize: (percentage: number) => void
}) {
  function beginResize(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    const workspace = event.currentTarget.parentElement
    if (!workspace) return
    const bounds = workspace.getBoundingClientRect()

    function move(pointerEvent: PointerEvent): void {
      const percentage =
        side === 'left'
          ? ((pointerEvent.clientX - bounds.left) / bounds.width) * 100
          : ((bounds.right - pointerEvent.clientX) / bounds.width) * 100
      onResize(percentage)
    }

    function stop(): void {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const direction = side === 'left' ? 1 : -1
    let nextValue: number | undefined
    if (event.key === 'ArrowLeft') nextValue = value - direction
    else if (event.key === 'ArrowRight') nextValue = value + direction
    else if (event.key === 'Home') nextValue = min
    else if (event.key === 'End') nextValue = max
    if (nextValue === undefined) return
    event.preventDefault()
    onResize(Math.min(max, Math.max(min, nextValue)))
  }

  return (
    <div
      className={`resize-handle resize-${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? '调整代码面板宽度' : '调整属性面板宽度'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={resizeWithKeyboard}
      onPointerDown={beginResize}
    />
  )
}

export function Workspace() {
  const projectName = useEditorStore((state) => state.projectName)
  const leaveWorkspace = useEditorStore((state) => state.leaveWorkspace)
  const snapshot = useEditorStore((state) => state.parseState.lastValidSnapshot)
  const parseState = useEditorStore((state) => state.parseState)
  const history = useEditorStore((state) => state.history)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const retryParse = useEditorStore((state) => state.retryParse)
  const density = useEditorStore((state) => state.density)
  const setDensity = useEditorStore((state) => state.setDensity)
  const theme = useEditorStore((state) => state.theme)
  const setTheme = useEditorStore((state) => state.setTheme)
  const mobileTab = useEditorStore((state) => state.mobileTab)
  const setMobileTab = useEditorStore((state) => state.setMobileTab)
  const loadOnboardingState = useEditorStore((state) => state.loadOnboardingState)
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState(25)
  const [rightWidth, setRightWidth] = useState(20)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [isNarrowWorkspace, setIsNarrowWorkspace] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(NARROW_WORKSPACE_QUERY).matches,
  )

  useEffect(() => {
    void loadOnboardingState()
  }, [loadOnboardingState])

  useEffect(() => {
    const media = window.matchMedia(NARROW_WORKSPACE_QUERY)
    const updateWorkspaceMode = () => setIsNarrowWorkspace(media.matches)
    updateWorkspaceMode()
    media.addEventListener('change', updateWorkspaceMode)
    return () => media.removeEventListener('change', updateWorkspaceMode)
  }, [])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return
      if (event.target instanceof Element && event.target.closest('.monaco-editor')) {
        return
      }
      const key = event.key.toLowerCase()
      const isUndo = key === 'z' && !event.shiftKey
      const isRedo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)
      if (!isUndo && !isRedo) return
      event.preventDefault()
      if (isRedo) redo()
      else if (isUndo) undo()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [redo, undo])

  const freshSnapshot =
    parseState.status === 'valid' && snapshot?.revision === parseState.sourceRevision
      ? snapshot
      : undefined
  const canonicalUnavailableReason =
    parseState.status === 'parsing'
      ? 'Schema 正在解析，完成后才能复制或下载最新内容'
      : parseState.status === 'invalid'
        ? 'Schema 代码有误，修复后才能复制或下载'
        : parseState.status === 'error'
          ? 'Schema 解析服务异常，请重试后再复制或下载'
          : parseState.status === 'valid'
            ? 'Schema 版本尚未同步，完成后才能复制或下载最新内容'
            : 'Schema 尚未完成解析，暂不能复制或下载'

  async function copySchema(): Promise<void> {
    if (!freshSnapshot) {
      toast.error(canonicalUnavailableReason)
      return
    }
    await navigator.clipboard.writeText(buildCombinedSchema(freshSnapshot))
    toast.success('Schema 已复制到剪贴板')
  }

  function downloadSchema(): void {
    if (!freshSnapshot) {
      toast.error(canonicalUnavailableReason)
      return
    }
    downloadSchemaProject(projectName, freshSnapshot)
    toast.success(
      Object.keys(freshSnapshot.files).length > 1
        ? '多文件项目已打包'
        : 'Schema 已下载',
    )
  }

  const workspaceStyle = {
    '--left-panel': leftCollapsed ? '0px' : `${leftWidth}%`,
    '--right-panel': rightCollapsed ? '0px' : `${rightWidth}%`,
  } as CSSProperties
  const renderCodePane = isNarrowWorkspace || !leftCollapsed
  const renderPropertiesPane = isNarrowWorkspace || !rightCollapsed
  const themeToggleLabel = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-project">
          <button
            className="icon-button"
            type="button"
            onClick={leaveWorkspace}
            aria-label="返回项目首页"
            title="返回项目首页"
          >
            <ArrowLeft size={15} />
          </button>
          <span className="brand-symbol small" aria-hidden="true">
            <Network size={14} />
          </span>
          <div className="project-title">
            <strong>{projectName}</strong>
            <span>
              <i className={`status-dot status-${parseState.status}`} />
              {parseState.status === 'invalid'
                ? '代码有误，画布只读'
                : parseState.status === 'parsing'
                  ? '正在同步'
                  : parseState.status === 'error'
                    ? '解析服务异常，画布只读'
                    : parseState.status === 'valid'
                      ? '已同步'
                      : '等待同步'}
              {parseState.status === 'error' && (
                <button
                  type="button"
                  onClick={retryParse}
                  aria-label="重试 Schema 解析"
                  title="重试 Schema 解析"
                  style={{
                    padding: 0,
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  重试
                </button>
              )}
            </span>
          </div>
        </div>

        <div className="workspace-tools" role="toolbar" aria-label="编辑工具">
          <button
            type="button"
            onClick={undo}
            disabled={!history.past.length}
            aria-label="撤销"
            title="撤销 Ctrl+Z"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!history.future.length}
            aria-label="重做"
            title="重做 Ctrl+Shift+Z"
          >
            <Redo2 size={15} />
          </button>
          <span className="toolbar-separator" />
          <button type="button" onClick={() => setAddModelOpen(true)}>
            <Plus size={15} />
            <span>模型</span>
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button">
                密度：
                {density === 'overview'
                  ? '概览'
                  : density === 'standard'
                    ? '标准'
                    : '完整'}
                <ChevronDown size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu-content" align="center">
                {(['overview', 'standard', 'full'] as const).map((value) => (
                  <DropdownMenu.Item
                    className="menu-item menu-radio"
                    key={value}
                    onSelect={() => setDensity(value)}
                  >
                    <span>{density === value && <Check size={13} />}</span>
                    {value === 'overview'
                      ? '概览'
                      : value === 'standard'
                        ? '标准'
                        : '完整'}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <span className="toolbar-separator" />
          <button
            type="button"
            onClick={() => setLeftCollapsed((value) => !value)}
            aria-label={leftCollapsed ? '展开代码面板' : '折叠代码面板'}
            title={leftCollapsed ? '展开代码面板' : '折叠代码面板'}
            aria-controls="workspace-code-pane"
            aria-expanded={!leftCollapsed}
          >
            {leftCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
          <button
            type="button"
            onClick={() => setRightCollapsed((value) => !value)}
            aria-label={rightCollapsed ? '展开属性面板' : '折叠属性面板'}
            title={rightCollapsed ? '展开属性面板' : '折叠属性面板'}
            aria-controls="workspace-properties-pane"
            aria-expanded={!rightCollapsed}
          >
            {rightCollapsed ? (
              <PanelRightOpen size={15} />
            ) : (
              <PanelRightClose size={15} />
            )}
          </button>
        </div>

        <div className="workspace-export">
          <button
            className="icon-button workspace-theme-toggle"
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={themeToggleLabel}
            title={themeToggleLabel}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            className="export-button"
            type="button"
            onClick={() => void copySchema()}
            disabled={!freshSnapshot}
            title={freshSnapshot ? '复制最新 Schema' : canonicalUnavailableReason}
          >
            <Clipboard size={14} /> 复制
          </button>
          <button
            className="export-button primary"
            type="button"
            onClick={downloadSchema}
            disabled={!freshSnapshot}
            title={freshSnapshot ? '下载最新 Schema' : canonicalUnavailableReason}
          >
            <Download size={14} /> 下载
          </button>
        </div>
      </header>

      <div
        className="workspace-grid"
        style={workspaceStyle}
        data-mobile-tab={mobileTab}
      >
        <div
          id="workspace-code-pane"
          className="workspace-pane pane-code"
          data-collapsed={!renderCodePane || undefined}
          aria-hidden={!renderCodePane || undefined}
        >
          {renderCodePane && <CodePanel />}
        </div>
        {!leftCollapsed && (
          <ResizeHandle
            side="left"
            value={leftWidth}
            min={16}
            max={40}
            onResize={(value) => setLeftWidth(Math.min(40, Math.max(16, value)))}
          />
        )}
        <div id="workspace-canvas-pane" className="workspace-pane pane-canvas">
          <SchemaCanvas onRequestAddModel={() => setAddModelOpen(true)} />
        </div>
        {!rightCollapsed && (
          <ResizeHandle
            side="right"
            value={rightWidth}
            min={16}
            max={34}
            onResize={(value) => setRightWidth(Math.min(34, Math.max(16, value)))}
          />
        )}
        <div
          id="workspace-properties-pane"
          className="workspace-pane pane-properties"
          data-collapsed={!renderPropertiesPane || undefined}
          aria-hidden={!renderPropertiesPane || undefined}
        >
          {renderPropertiesPane && <InspectorPanel />}
        </div>
      </div>

      <nav className="mobile-workspace-tabs" aria-label="手机端工作区">
        <button
          type="button"
          className={mobileTab === 'code' ? 'is-active' : ''}
          onClick={() => setMobileTab('code')}
          aria-pressed={mobileTab === 'code'}
        >
          <Code2 size={16} /> 代码
        </button>
        <button
          type="button"
          className={mobileTab === 'canvas' ? 'is-active' : ''}
          onClick={() => setMobileTab('canvas')}
          aria-pressed={mobileTab === 'canvas'}
        >
          <Network size={16} /> 画布
        </button>
        <button
          type="button"
          className={mobileTab === 'properties' ? 'is-active' : ''}
          onClick={() => setMobileTab('properties')}
          aria-pressed={mobileTab === 'properties'}
        >
          <PanelRightOpen size={16} /> 属性
        </button>
        <button
          type="button"
          className="mobile-theme-toggle"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={themeToggleLabel}
          title={themeToggleLabel}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span>主题</span>
        </button>
      </nav>

      <AddModelDialog open={addModelOpen} onOpenChange={setAddModelOpen} />
      <LayoutDirectionDialog />
      <OnboardingTour />
    </main>
  )
}
