import {
  Braces,
  ChevronRight,
  CircleDot,
  CircleHelp,
  Database,
  FileCode2,
  Table2,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'

import type { OnMount } from '@monaco-editor/react'

import type {
  ModelDeclaration,
  SchemaDeclaration,
  SourceRange,
  VirtualSchemaFile,
} from '@/domain/schema'
import { useEditorStore } from '@/state'

const MonacoEditor = lazy(async () => {
  const module = await import('@monaco-editor/react')
  return { default: module.default }
})

type VisualDeclaration = Exclude<SchemaDeclaration, { readonly kind: 'commentBlock' }>
type EditorInstance = Parameters<OnMount>[0]
type MonacoApi = Parameters<OnMount>[1]

interface SourceHighlight {
  readonly range: SourceRange
  readonly kind: 'selection' | 'peer' | 'model'
}

function applySourceHighlights(
  editor: EditorInstance,
  monaco: MonacoApi,
  highlights: readonly SourceHighlight[],
  previousDecorations: readonly string[],
): string[] {
  const decorations = editor.deltaDecorations(
    [...previousDecorations],
    highlights.map((highlight) => {
      const startLine = highlight.range.start.line
      const endLine =
        highlight.kind === 'model'
          ? highlight.range.start.line
          : highlight.range.end.line
      return {
        range: new monaco.Range(startLine, 1, endLine, Number.MAX_SAFE_INTEGER),
        options: {
          isWholeLine: true,
          className:
            highlight.kind === 'peer'
              ? 'monaco-linked-peer-line'
              : 'monaco-selected-source-line',
          linesDecorationsClassName:
            highlight.kind === 'peer'
              ? 'monaco-linked-peer-glyph'
              : 'monaco-selected-source-glyph',
        },
      }
    }),
  )
  const first = highlights[0]
  if (first) {
    editor.revealLineInCenter(first.range.start.line, monaco.editor.ScrollType.Smooth)
  }
  return decorations
}

function declarationIcon(declaration: SchemaDeclaration) {
  if (declaration.kind === 'model' || declaration.kind === 'view') {
    return <Table2 size={14} />
  }
  if (declaration.kind === 'enum') return <Braces size={14} />
  if (declaration.kind === 'datasource') return <Database size={14} />
  return <CircleDot size={14} />
}

function configurePrismaMonaco(monaco: MonacoApi): void {
  if (
    !monaco.languages
      .getLanguages()
      .some((language: { id: string }) => language.id === 'prisma')
  ) {
    monaco.languages.register({ id: 'prisma' })
    monaco.languages.setMonarchTokensProvider('prisma', {
      keywords: ['model', 'enum', 'datasource', 'generator', 'type', 'view'],
      typeKeywords: [
        'String',
        'Int',
        'BigInt',
        'Float',
        'Decimal',
        'Boolean',
        'DateTime',
        'Json',
        'Bytes',
      ],
      tokenizer: {
        root: [
          [/\/\/\/.*$/, 'comment.doc'],
          [/\/\/.*$/, 'comment'],
          [/@{1,2}[\w.]+/, 'annotation'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/[A-Z][\w]*/, 'type.identifier'],
          [
            /[a-zA-Z_]\w*/,
            {
              cases: {
                '@keywords': 'keyword',
                '@typeKeywords': 'type',
                '@default': 'identifier',
              },
            },
          ],
          [/\d+(\.\d+)?/, 'number'],
          [/[{}()[\],:?=]/, 'delimiter'],
        ],
      },
    })
  }
  monaco.editor.defineTheme('schema-graph-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'B7BFFF', fontStyle: 'bold' },
      { token: 'type', foreground: '80B8AE' },
      { token: 'type.identifier', foreground: 'D3A36F' },
      { token: 'annotation', foreground: 'C7A3D8' },
      { token: 'comment.doc', foreground: '6F9C82', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#101216',
      'editorLineNumber.foreground': '#484d57',
      'editorLineNumber.activeForeground': '#9ba0aa',
      'editor.selectionBackground': '#303746',
      'editor.lineHighlightBackground': '#15181d',
    },
  })
  monaco.editor.defineTheme('schema-graph-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '4854A8', fontStyle: 'bold' },
      { token: 'type', foreground: '307469' },
      { token: 'type.identifier', foreground: '9A5F29' },
      { token: 'annotation', foreground: '7D518F' },
      { token: 'comment.doc', foreground: '427154', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#F8F8F6',
      'editorLineNumber.foreground': '#B0B1AD',
      'editorLineNumber.activeForeground': '#5F625E',
      'editor.selectionBackground': '#DCE0F2',
      'editor.lineHighlightBackground': '#F0F0EC',
    },
  })
}

function MonacoPane({
  file,
  highlights,
  theme,
  statusLabel,
  onChange,
}: {
  readonly file: VirtualSchemaFile
  readonly highlights: readonly SourceHighlight[]
  readonly theme: 'light' | 'dark'
  readonly statusLabel?: string
  readonly onChange: (content: string) => void
}) {
  const editorRef = useRef<EditorInstance | null>(null)
  const monacoRef = useRef<MonacoApi | null>(null)
  const decorationsRef = useRef<string[]>([])

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    decorationsRef.current = applySourceHighlights(
      editor,
      monaco,
      highlights,
      decorationsRef.current,
    )
  }, [highlights])

  return (
    <div className="editor-pane">
      <div className="editor-filebar">
        <div>
          <FileCode2 size={13} />
          <span>{file.path}</span>
        </div>
        {statusLabel && <span className="parse-indicator">{statusLabel}</span>}
      </div>
      <div className="monaco-shell">
        <Suspense
          fallback={
            <div className="editor-loading">
              <ChevronRight size={14} /> 正在加载编辑器
            </div>
          }
        >
          <MonacoEditor
            path={`file:///${file.path}`}
            language="prisma"
            value={file.content}
            theme={theme === 'dark' ? 'schema-graph-dark' : 'schema-graph-light'}
            beforeMount={configurePrismaMonaco}
            onMount={(editor, monaco) => {
              editorRef.current = editor
              monacoRef.current = monaco
              decorationsRef.current = applySourceHighlights(
                editor,
                monaco,
                highlights,
                decorationsRef.current,
              )
            }}
            onChange={(value) => onChange(value ?? '')}
            options={{
              automaticLayout: true,
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 12.5,
              lineHeight: 21,
              minimap: { enabled: false },
              folding: true,
              glyphMargin: false,
              lineNumbersMinChars: 3,
              padding: { top: 14, bottom: 18 },
              renderLineHighlight: 'line',
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              stickyScroll: { enabled: true, maxLineCount: 2 },
              wordWrap: 'off',
            }}
          />
        </Suspense>
      </div>
    </div>
  )
}

export function CodePanel() {
  const files = useEditorStore((state) => state.history.present.files)
  const activeFilePath = useEditorStore((state) => state.activeFilePath)
  const setActiveFile = useEditorStore((state) => state.setActiveFile)
  const updateFileContent = useEditorStore((state) => state.updateFileContent)
  const focusNodeFromNavigation = useEditorStore(
    (state) => state.focusNodeFromNavigation,
  )
  const openTour = useEditorStore((state) => state.openTour)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedFieldId = useEditorStore((state) => state.selectedFieldId)
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId)
  const parseState = useEditorStore((state) => state.parseState)
  const theme = useEditorStore((state) => state.theme)
  const snapshot = parseState.lastValidSnapshot
  const activeFile = files.find((file) => file.path === activeFilePath) ?? files[0]
  const declarations = useMemo(
    () =>
      snapshot?.graph.declarations.filter(
        (declaration): declaration is VisualDeclaration =>
          declaration.kind !== 'commentBlock' &&
          declaration.source.filePath === activeFile?.path,
      ) ?? [],
    [activeFile?.path, snapshot],
  )
  const selectedDeclaration = snapshot?.graph.declarations.find(
    (declaration) =>
      declaration.kind !== 'commentBlock' && declaration.id === selectedNodeId,
  )
  const selectedField = snapshot?.graph.declarations
    .filter(
      (declaration): declaration is ModelDeclaration =>
        declaration.kind === 'model' ||
        declaration.kind === 'view' ||
        declaration.kind === 'type',
    )
    .flatMap((declaration) => declaration.members)
    .find((member) => member.kind === 'field' && member.id === selectedFieldId)
  const selectedRelation = snapshot?.graph.logicalRelations.find(
    (relation) => relation.id === selectedEdgeId,
  )
  const highlightsByFile = useMemo(() => {
    const highlights = new Map<string, SourceHighlight[]>()
    const append = (
      filePath: string | undefined,
      range: SourceRange | undefined,
      kind: SourceHighlight['kind'],
    ): void => {
      if (!filePath || !range) return
      const entries = highlights.get(filePath) ?? []
      entries.push({ range, kind })
      highlights.set(filePath, entries)
    }

    if (selectedRelation) {
      selectedRelation.source.sources.forEach((source) =>
        append(source.filePath, source.range, 'selection'),
      )
      selectedRelation.target.sources.forEach((source) =>
        append(source.filePath, source.range, 'peer'),
      )
    } else if (selectedField?.kind === 'field') {
      append(selectedField.source.filePath, selectedField.source.range, 'selection')
    } else if (selectedDeclaration && selectedDeclaration.kind !== 'commentBlock') {
      append(
        selectedDeclaration.source.filePath,
        selectedDeclaration.source.range,
        'model',
      )
    }
    return highlights
  }, [selectedDeclaration, selectedField, selectedRelation])
  const relationFiles = selectedRelation
    ? [...highlightsByFile.keys()]
        .map((path) => files.find((file) => file.path === path))
        .filter((file): file is VirtualSchemaFile => Boolean(file))
        .slice(0, 2)
    : []
  const paneFiles =
    relationFiles.length > 1 ? relationFiles : activeFile ? [activeFile] : []
  const statusLabel =
    parseState.status === 'parsing'
      ? '解析中'
      : parseState.status === 'invalid'
        ? `${parseState.diagnostics.length} 个问题`
        : '结构有效'

  return (
    <section className="code-panel" aria-label="Schema 代码">
      <nav className="structure-rail" aria-label="项目结构">
        <div className="rail-title">结构</div>
        <div className="rail-files">
          {files.map((file) => (
            <button
              type="button"
              key={file.path}
              className={file.path === activeFile?.path ? 'is-active' : ''}
              onClick={() => setActiveFile(file.path)}
              title={file.path}
            >
              <FileCode2 size={15} />
              <span>{file.path.split('/').at(-1)?.replace('.prisma', '')}</span>
            </button>
          ))}
        </div>
        <div className="rail-divider" />
        <div className="rail-symbols">
          {declarations.map((declaration) => (
            <button
              key={declaration.id}
              type="button"
              className={declaration.id === selectedNodeId ? 'is-active' : ''}
              onClick={() => focusNodeFromNavigation(declaration.id)}
              title={`在画布中聚焦 ${declaration.name}`}
            >
              {declarationIcon(declaration)}
              <span>{declaration.name}</span>
            </button>
          ))}
        </div>
        <button
          className="tour-trigger"
          type="button"
          onClick={openTour}
          aria-label="打开新手指引"
          title="新手指引"
        >
          <CircleHelp size={16} />
        </button>
      </nav>

      <div className={`editor-column ${paneFiles.length > 1 ? 'is-split' : ''}`}>
        {paneFiles.length ? (
          paneFiles.map((file, index) => (
            <MonacoPane
              key={file.path}
              file={file}
              highlights={highlightsByFile.get(file.path) ?? []}
              theme={theme}
              statusLabel={index === 0 ? statusLabel : '关系另一端'}
              onChange={(content) => updateFileContent(file.path, content)}
            />
          ))
        ) : (
          <div className="empty-pane">项目中没有 Schema 文件</div>
        )}
      </div>
    </section>
  )
}
