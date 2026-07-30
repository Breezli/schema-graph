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
  onResize,
}: {
  readonly side: 'left' | 'right'
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

  return <div className={`resize-handle resize-${side}`} onPointerDown={beginResize} />
}

export function Workspace() {
  const projectName = useEditorStore((state) => state.projectName)
  const leaveWorkspace = useEditorStore((state) => state.leaveWorkspace)
  const snapshot = useEditorStore((state) => state.parseState.lastValidSnapshot)
  const parseState = useEditorStore((state) => state.parseState)
  const history = useEditorStore((state) => state.history)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
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

  useEffect(() => {
    void loadOnboardingState()
  }, [loadOnboardingState])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [redo, undo])

  async function copySchema(): Promise<void> {
    if (!snapshot) {
      toast.error('当前没有可复制的有效 Schema')
      return
    }
    await navigator.clipboard.writeText(buildCombinedSchema(snapshot))
    toast.success('Schema 已复制到剪贴板')
  }

  function downloadSchema(): void {
    if (!snapshot) {
      toast.error('当前没有可下载的有效 Schema')
      return
    }
    downloadSchemaProject(projectName, snapshot)
    toast.success(
      snapshot && Object.keys(snapshot.files).length > 1
        ? '多文件项目已打包'
        : 'Schema 已下载',
    )
  }

  const workspaceStyle = {
    '--left-panel': leftCollapsed ? '0px' : `${leftWidth}%`,
    '--right-panel': rightCollapsed ? '0px' : `${rightWidth}%`,
  } as CSSProperties

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-project">
          <button
            className="icon-button"
            type="button"
            onClick={leaveWorkspace}
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
                  : '已同步'}
            </span>
          </div>
        </div>

        <div className="workspace-tools" role="toolbar" aria-label="编辑工具">
          <button
            type="button"
            onClick={undo}
            disabled={!history.past.length}
            title="撤销 Ctrl+Z"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!history.future.length}
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
            title={leftCollapsed ? '展开代码面板' : '折叠代码面板'}
          >
            {leftCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
          <button
            type="button"
            onClick={() => setRightCollapsed((value) => !value)}
            title={rightCollapsed ? '展开属性面板' : '折叠属性面板'}
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
            className="icon-button"
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            className="export-button"
            type="button"
            onClick={() => void copySchema()}
          >
            <Clipboard size={14} /> 复制
          </button>
          <button
            className="export-button primary"
            type="button"
            onClick={downloadSchema}
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
        <div className="workspace-pane pane-code">
          <CodePanel />
        </div>
        {!leftCollapsed && (
          <ResizeHandle
            side="left"
            onResize={(value) => setLeftWidth(Math.min(40, Math.max(16, value)))}
          />
        )}
        <div className="workspace-pane pane-canvas">
          <SchemaCanvas onRequestAddModel={() => setAddModelOpen(true)} />
        </div>
        {!rightCollapsed && (
          <ResizeHandle
            side="right"
            onResize={(value) => setRightWidth(Math.min(34, Math.max(16, value)))}
          />
        )}
        <div className="workspace-pane pane-properties">
          <InspectorPanel />
        </div>
      </div>

      <nav className="mobile-workspace-tabs" aria-label="手机端工作区">
        <button
          type="button"
          className={mobileTab === 'code' ? 'is-active' : ''}
          onClick={() => setMobileTab('code')}
        >
          <Code2 size={16} /> 代码
        </button>
        <button
          type="button"
          className={mobileTab === 'canvas' ? 'is-active' : ''}
          onClick={() => setMobileTab('canvas')}
        >
          <Network size={16} /> 画布
        </button>
        <button
          type="button"
          className={mobileTab === 'properties' ? 'is-active' : ''}
          onClick={() => setMobileTab('properties')}
        >
          <PanelRightOpen size={16} /> 属性
        </button>
      </nav>

      <AddModelDialog open={addModelOpen} onOpenChange={setAddModelOpen} />
      <LayoutDirectionDialog />
      <OnboardingTour />
    </main>
  )
}
