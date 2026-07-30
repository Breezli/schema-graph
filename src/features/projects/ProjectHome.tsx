import {
  ArrowUpRight,
  Braces,
  Clock3,
  Database,
  FileCode2,
  FolderInput,
  Moon,
  Network,
  Plus,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react'
import { Dialog } from 'radix-ui'
import { type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { createVirtualSchemaFile } from '@/domain/schema'
import { filesFromFileList } from '@/platform'
import { useEditorStore } from '@/state'

import { projectTemplates } from './templates'

export function ProjectHome() {
  const createBlankProject = useEditorStore((state) => state.createBlankProject)
  const openTemplate = useEditorStore((state) => state.openTemplate)
  const openLocalFiles = useEditorStore((state) => state.openLocalFiles)
  const theme = useEditorStore((state) => state.theme)
  const setTheme = useEditorStore((state) => state.setTheme)
  const localProjects = useEditorStore((state) => state.localProjects)
  const loadLocalProjects = useEditorStore((state) => state.loadLocalProjects)
  const openStoredProject = useEditorStore((state) => state.openStoredProject)
  const deleteLocalProject = useEditorStore((state) => state.deleteLocalProject)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pastedSchema, setPastedSchema] = useState('')
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void loadLocalProjects()
  }, [loadLocalProjects])

  async function importFiles(files: FileList | readonly File[]): Promise<void> {
    const schemaFiles = await filesFromFileList(files)
    if (!schemaFiles.length) {
      toast.error('没有找到 .prisma 文件')
      return
    }
    const firstName = schemaFiles[0]?.path
      .split('/')
      .at(-1)
      ?.replace(/\.prisma$/i, '')
    openLocalFiles(firstName || '导入的 Schema', schemaFiles)
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    event.preventDefault()
    setDragging(false)
    void importFiles(event.dataTransfer.files)
  }

  function handlePasteSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!pastedSchema.trim()) {
      toast.error('请先粘贴 Prisma Schema')
      return
    }
    openLocalFiles('粘贴的 Schema', [
      createVirtualSchemaFile('schema.prisma', pastedSchema),
    ])
    setPasteOpen(false)
    setPastedSchema('')
  }

  return (
    <main
      className={`project-home ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false)
        }
      }}
      onDrop={handleDrop}
    >
      <header className="home-header">
        <a className="brand-lockup" href="/" aria-label="Schema Graph 首页">
          <span className="brand-symbol" aria-hidden="true">
            <Network size={16} />
          </span>
          <span>Schema Graph</span>
          <span className="brand-edition">LOCAL</span>
        </a>
        <div className="home-header-actions">
          <span className="offline-note">数据只保存在此浏览器</span>
          <button
            className="icon-button"
            type="button"
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      <section className="home-hero" aria-labelledby="home-title">
        <div className="hero-index" aria-hidden="true">
          01 / 结构工作台
        </div>
        <div className="hero-copy">
          <div className="hero-kicker">
            <span /> PRISMA VISUAL WORKSPACE
          </div>
          <h1 id="home-title">给 Prisma Schema 一张可以编辑的地图。</h1>
          <p>
            读代码，也读关系。Schema Graph 在浏览器里解析多文件 Schema，
            让字段、约束和关联变成一张可直接修改的结构图。
          </p>
          <div className="hero-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => createBlankProject()}
            >
              <Plus size={16} />
              新建本地项目
            </button>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <FolderInput size={16} />
              导入文件
            </button>
            <Dialog.Root open={pasteOpen} onOpenChange={setPasteOpen}>
              <Dialog.Trigger asChild>
                <button className="text-button" type="button">
                  粘贴 Schema <ArrowUpRight size={14} />
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                <Dialog.Content className="dialog-content paste-dialog">
                  <Dialog.Title>粘贴 Prisma Schema</Dialog.Title>
                  <Dialog.Description>
                    内容会作为 schema.prisma 打开；之后仍可继续加入更多文件。
                  </Dialog.Description>
                  <form onSubmit={handlePasteSubmit}>
                    <textarea
                      autoFocus
                      value={pastedSchema}
                      onChange={(event) => setPastedSchema(event.target.value)}
                      placeholder={'model User {\n  id Int @id\n}'}
                      aria-label="Prisma Schema 内容"
                    />
                    <div className="dialog-actions">
                      <Dialog.Close asChild>
                        <button className="button button-ghost" type="button">
                          取消
                        </button>
                      </Dialog.Close>
                      <button className="button button-primary" type="submit">
                        打开工作台
                      </button>
                    </div>
                  </form>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </div>

        <div className="hero-diagram" aria-hidden="true">
          <div className="diagram-caption">LIVE STRUCTURE / 04 NODES</div>
          <div className="diagram-node node-user">
            <span>User</span>
            <small>6 fields</small>
          </div>
          <div className="diagram-node node-post">
            <span>Post</span>
            <small>9 fields</small>
          </div>
          <div className="diagram-node node-role special">
            <span>Role</span>
            <small>enum</small>
          </div>
          <svg viewBox="0 0 500 360" preserveAspectRatio="none">
            <path d="M155 100 C 260 100, 222 230, 340 230" />
            <path d="M135 140 C 130 250, 280 280, 352 282" />
            <circle cx="155" cy="100" r="4" />
            <circle cx="340" cy="230" r="4" />
          </svg>
          <div className="diagram-grid-label">RELATION MAP / 1:∞</div>
        </div>
      </section>

      {localProjects.length > 0 && (
        <section className="home-section recent-section" aria-labelledby="recent-title">
          <div className="section-heading">
            <div>
              <span className="section-index">02</span>
              <h2 id="recent-title">最近的本地项目</h2>
            </div>
            <p>{localProjects.length} 个项目保存在 IndexedDB</p>
          </div>
          <div className="recent-projects">
            {localProjects.slice(0, 6).map((project) => (
              <article className="recent-project" key={project.id}>
                <button
                  className="recent-project-open"
                  type="button"
                  onClick={() => void openStoredProject(project.id)}
                >
                  <span className="recent-project-icon">
                    <Network size={15} />
                  </span>
                  <span className="recent-project-copy">
                    <strong>{project.name}</strong>
                    <small>
                      <Clock3 size={11} />
                      {new Intl.DateTimeFormat('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(project.lastOpenedAt)}
                    </small>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
                <button
                  className="recent-project-delete"
                  type="button"
                  aria-label={`删除项目 ${project.name}`}
                  onClick={() => {
                    if (window.confirm(`确定从此浏览器删除“${project.name}”吗？`)) {
                      void deleteLocalProject(project.id)
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <section
        className="home-section template-section"
        aria-labelledby="templates-title"
      >
        <div className="section-heading">
          <div>
            <span className="section-index">{localProjects.length ? '03' : '02'}</span>
            <h2 id="templates-title">从一个真实结构开始</h2>
          </div>
          <p>示例项目完全本地运行，可以随意拆解和修改。</p>
        </div>
        <div className="template-grid">
          {projectTemplates.map((template, index) => (
            <button
              className="template-card"
              type="button"
              key={template.id}
              onClick={() => openTemplate(template.id)}
            >
              <div className="template-card-topline">
                <span>0{index + 1}</span>
                {index === 0 && (
                  <span className="recommended-badge">
                    <Sparkles size={11} /> 推荐
                  </span>
                )}
              </div>
              <div className="template-icon" aria-hidden="true">
                {index === 0 ? (
                  <FileCode2 size={20} />
                ) : index === 1 ? (
                  <Database size={20} />
                ) : (
                  <Braces size={20} />
                )}
              </div>
              <h3>{template.name}</h3>
              <p>{template.description}</p>
              <div className="template-meta">
                <span>{template.meta}</span>
                <ArrowUpRight size={15} />
              </div>
            </button>
          ))}
        </div>
      </section>

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept=".prisma"
        multiple
        aria-label="选择 Prisma Schema 文件"
        onChange={(event) => {
          if (event.target.files) void importFiles(event.target.files)
          event.target.value = ''
        }}
      />

      {dragging && (
        <div className="drop-curtain" aria-hidden="true">
          <FolderInput size={28} />
          <strong>把 .prisma 文件放到这里</strong>
          <span>支持一次导入多个文件</span>
        </div>
      )}
    </main>
  )
}
