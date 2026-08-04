import {
  Braces,
  ChevronRight,
  CircleDot,
  CircleHelp,
  Database,
  FileCode2,
  Table2,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'

import type { OnMount } from '@monaco-editor/react'

import type {
  ModelDeclaration,
  SchemaDeclaration,
  SchemaDiagnostic,
  SourceRange,
  VirtualSchemaFile,
} from '@/domain/schema'
import { useEditorStore, type SourceNavigationRequest } from '@/state'

import {
  prepareDiagnosticMarkers,
  SCHEMA_DIAGNOSTIC_MARKER_OWNER,
} from './diagnostic-markers'
import { alignPrismaFieldsForTab } from './prisma-field-alignment'

const MonacoEditor = lazy(async () => {
  const module = await import('./LocalMonacoEditor')
  return { default: module.default }
})

type VisualDeclaration = Exclude<SchemaDeclaration, { readonly kind: 'commentBlock' }>
type EditorInstance = Parameters<OnMount>[0]
type MonacoApi = Parameters<OnMount>[1]

const PRISMA_FIELD_TAB_CONTEXT_KEY = 'schemaGraphPrismaFieldTabEligible'
const PRISMA_FIELD_TAB_CONTEXT = [
  PRISMA_FIELD_TAB_CONTEXT_KEY,
  'editorTextFocus',
  '!inSnippetMode',
  '!suggestWidgetVisible',
  '!inlineSuggestionVisible',
  '!renameInputVisible',
  '!editorTabMovesFocus',
  "config.editor.tabCompletion != 'on'",
].join(' && ')

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
  return decorations
}

const diagnosticSeverityLabel = {
  error: '错误',
  warning: '警告',
  info: '信息',
} as const

function diagnosticMessage(diagnostic: SchemaDiagnostic): string {
  if (diagnostic.code === 'syntax-error') {
    return `Prisma Schema 语法错误：${diagnostic.message}`
  }
  if (diagnostic.code === 'schema-parser-worker-failure') {
    return `Schema 解析服务异常：${diagnostic.message}`
  }
  return /[\u3400-\u9fff]/u.test(diagnostic.message)
    ? diagnostic.message
    : `Schema 问题：${diagnostic.message}`
}

function diagnosticLocation(diagnostic: SchemaDiagnostic): string {
  const start = diagnostic.range?.start
  return start ? `第 ${start.line} 行 · 第 ${start.column} 列` : '位置未知'
}

function ProblemsPanel({
  diagnostics,
  onNavigate,
}: {
  readonly diagnostics: readonly SchemaDiagnostic[]
  readonly onNavigate: (filePath: string, range?: SourceRange) => void
}) {
  return (
    <section
      className="editor-problems-panel"
      aria-label="Schema 问题"
      style={{ maxHeight: 144, overflowY: 'auto' }}
    >
      <header className="editor-problems-header">
        <strong>问题</strong>
        <span className="editor-problems-count">{diagnostics.length}</span>
      </header>
      <ul className="editor-problems-list">
        {diagnostics.map((diagnostic, index) => {
          const content = (
            <>
              <span className={`editor-problem-severity is-${diagnostic.severity}`}>
                {diagnosticSeverityLabel[diagnostic.severity]}
              </span>
              <span className="editor-problem-message">
                {diagnosticMessage(diagnostic)}
              </span>
              <span className="editor-problem-file">
                {diagnostic.filePath ?? '全局'}
              </span>
              <span className="editor-problem-location">
                {diagnosticLocation(diagnostic)}
              </span>
            </>
          )
          return (
            <li
              className={`editor-problem-row is-${diagnostic.severity}`}
              key={`${diagnostic.code}:${diagnostic.filePath ?? 'global'}:${diagnostic.range?.start.offset ?? 'unknown'}:${index}`}
            >
              {diagnostic.filePath ? (
                <button
                  type="button"
                  className="editor-problem-navigation"
                  onClick={() =>
                    onNavigate(diagnostic.filePath as string, diagnostic.range)
                  }
                >
                  {content}
                </button>
              ) : (
                <div className="editor-problem-description">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
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
      'editorLineNumber.foreground': '#858d99',
      'editorLineNumber.activeForeground': '#c3c8d0',
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
      { token: 'type.identifier', foreground: '8F541F' },
      { token: 'annotation', foreground: '7D518F' },
      { token: 'comment.doc', foreground: '427154', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#F8F8F6',
      'editorLineNumber.foreground': '#626762',
      'editorLineNumber.activeForeground': '#363A36',
      'editor.selectionBackground': '#DCE0F2',
      'editor.lineHighlightBackground': '#F0F0EC',
    },
  })
}

function MonacoPane({
  file,
  highlights,
  diagnostics,
  navigationRequest,
  editorSessionId,
  problemPanel,
  theme,
  statusLabel,
  onUndo,
  onRedo,
  onChange,
  onAcknowledgeNavigation,
}: {
  readonly file: VirtualSchemaFile
  readonly highlights: readonly SourceHighlight[]
  readonly diagnostics: readonly SchemaDiagnostic[]
  readonly navigationRequest?: SourceNavigationRequest
  readonly editorSessionId: number
  readonly problemPanel?: ReactNode
  readonly theme: 'light' | 'dark'
  readonly statusLabel?: string
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onChange: (content: string, options?: { readonly atomic?: boolean }) => void
  readonly onAcknowledgeNavigation: (requestId: number, filePath: string) => void
}) {
  const editorRef = useRef<EditorInstance | null>(null)
  const monacoRef = useRef<MonacoApi | null>(null)
  const decorationsRef = useRef<string[]>([])
  const atomicChangePendingRef = useRef(false)
  const tabRegistrationRef = useRef<{ dispose: () => void } | null>(null)
  const historyRegistrationRef = useRef<{ dispose: () => void } | null>(null)
  const modelListenerRef = useRef<{ dispose: () => void } | null>(null)
  const markerModelRef = useRef<ReturnType<EditorInstance['getModel']>>(null)
  const consumedNavigationRef = useRef(new Set<string>())
  const diagnosticsRef = useRef(diagnostics)
  const highlightsRef = useRef(highlights)
  const navigationRequestRef = useRef(navigationRequest)

  useEffect(() => {
    diagnosticsRef.current = diagnostics
    highlightsRef.current = highlights
    navigationRequestRef.current = navigationRequest
  }, [diagnostics, highlights, navigationRequest])

  const disposeTabRegistration = (): void => {
    tabRegistrationRef.current?.dispose()
    tabRegistrationRef.current = null
  }

  const registerTabAction = (editor: EditorInstance, monaco: MonacoApi): void => {
    disposeTabRegistration()
    atomicChangePendingRef.current = false

    const eligible = editor.createContextKey<boolean>(
      PRISMA_FIELD_TAB_CONTEXT_KEY,
      false,
    )
    const alignmentAtSelection = () => {
      const model = editor.getModel()
      const selection = editor.getSelection()
      const selections = editor.getSelections()
      if (!model || !selection || !selections) return undefined

      return alignPrismaFieldsForTab({
        text: model.getValue(),
        cursor: {
          line: selection.positionLineNumber,
          column: selection.positionColumn,
        },
        selection: {
          start: {
            line: selection.startLineNumber,
            column: selection.startColumn,
          },
          end: {
            line: selection.endLineNumber,
            column: selection.endColumn,
          },
        },
        lineEnding: model.getEOL() === '\r\n' ? '\r\n' : '\n',
        cursorCount: selections.length,
      })
    }
    const syncEligibility = (): void => {
      eligible.set(alignmentAtSelection()?.kind === 'edit')
    }

    const action = editor.addAction({
      id: 'schema-graph.align-prisma-fields-for-tab',
      label: 'Align Prisma field columns',
      precondition: PRISMA_FIELD_TAB_CONTEXT,
      keybindings: [monaco.KeyCode.Tab],
      run: (actionEditor) => {
        const model = actionEditor.getModel()
        const result = alignmentAtSelection()
        if (!model || !result || result.kind === 'noop') {
          atomicChangePendingRef.current = false
          eligible.set(false)
          return
        }

        const cursor = {
          lineNumber: result.cursor.line,
          column: result.cursor.column,
        }
        if (!result.changed) {
          atomicChangePendingRef.current = false
          actionEditor.setPosition(cursor)
          actionEditor.revealPositionInCenterIfOutsideViewport(
            cursor,
            monaco.editor.ScrollType.Smooth,
          )
          syncEligibility()
          return
        }

        actionEditor.pushUndoStop()
        try {
          atomicChangePendingRef.current = true
          const applied = actionEditor.executeEdits(
            'schema-graph.align-prisma-fields-for-tab',
            [
              {
                range: new monaco.Range(
                  result.replacementRange.start.line,
                  result.replacementRange.start.column,
                  result.replacementRange.end.line,
                  result.replacementRange.end.column,
                ),
                text: result.replacementText,
                forceMoveMarkers: true,
              },
            ],
            [
              new monaco.Selection(
                result.cursor.line,
                result.cursor.column,
                result.cursor.line,
                result.cursor.column,
              ),
            ],
          )
          if (!applied || atomicChangePendingRef.current) {
            atomicChangePendingRef.current = false
          }
          if (applied) {
            actionEditor.pushUndoStop()
            actionEditor.revealPositionInCenterIfOutsideViewport(
              cursor,
              monaco.editor.ScrollType.Smooth,
            )
          }
        } catch (error) {
          atomicChangePendingRef.current = false
          syncEligibility()
          throw error
        }
        syncEligibility()
      },
    })
    const selectionListener = editor.onDidChangeCursorSelection(syncEligibility)
    const contentListener = editor.onDidChangeModelContent(syncEligibility)
    syncEligibility()

    tabRegistrationRef.current = {
      dispose: () => {
        eligible.reset()
        selectionListener.dispose()
        contentListener.dispose()
        action.dispose()
      },
    }
  }

  const registerHistoryActions = (editor: EditorInstance, monaco: MonacoApi): void => {
    historyRegistrationRef.current?.dispose()
    const undoAction = editor.addAction({
      id: 'schema-graph.application-undo',
      label: '撤销应用操作',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
      run: () => onUndo(),
    })
    const redoAction = editor.addAction({
      id: 'schema-graph.application-redo',
      label: '重做应用操作',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
      ],
      run: () => onRedo(),
    })
    historyRegistrationRef.current = {
      dispose: () => {
        undoAction.dispose()
        redoAction.dispose()
      },
    }
  }

  const syncDiagnosticMarkers = useCallback(
    (editor: EditorInstance, monaco: MonacoApi): void => {
      const model = editor.getModel()
      const previousModel = markerModelRef.current
      if (previousModel && previousModel !== model) {
        monaco.editor.setModelMarkers(previousModel, SCHEMA_DIAGNOSTIC_MARKER_OWNER, [])
      }
      markerModelRef.current = model
      if (!model) return
      const localizedDiagnostics = diagnosticsRef.current.map((diagnostic) => ({
        ...diagnostic,
        message: diagnosticMessage(diagnostic),
      }))
      monaco.editor.setModelMarkers(
        model,
        SCHEMA_DIAGNOSTIC_MARKER_OWNER,
        prepareDiagnosticMarkers(localizedDiagnostics, file.path, model),
      )
    },
    [file.path],
  )

  const consumeSourceNavigation = useCallback(
    (editor: EditorInstance, monaco: MonacoApi): void => {
      const request = navigationRequestRef.current
      if (!request) return
      if (request.editorSessionId !== editorSessionId) return
      if (request.filePath && request.filePath !== file.path) return
      if (request.consumedFilePaths.includes(file.path)) return

      const targetRange =
        request.kind === 'diagnostic' ? request.range : highlightsRef.current[0]?.range
      if (request.kind === 'selection' && !targetRange) return

      const key = `${request.editorSessionId}:${request.id}:${file.path}`
      if (consumedNavigationRef.current.has(key)) return

      const model = editor.getModel()
      if (!model) return
      consumedNavigationRef.current.add(key)
      const lineNumber = Math.min(
        Math.max(targetRange?.start.line ?? 1, 1),
        Math.max(model.getLineCount(), 1),
      )
      const column = Math.min(
        Math.max(targetRange?.start.column ?? 1, 1),
        Math.max(model.getLineMaxColumn(lineNumber), 1),
      )

      if (request.kind === 'diagnostic') {
        try {
          const position = { lineNumber, column }
          editor.setPosition(position)
          editor.revealPositionInCenter(position, monaco.editor.ScrollType.Smooth)
          editor.focus()
          onAcknowledgeNavigation(request.id, file.path)
        } catch (error) {
          consumedNavigationRef.current.delete(key)
          throw error
        }
        return
      }
      try {
        editor.revealLineInCenter(lineNumber, monaco.editor.ScrollType.Smooth)
        onAcknowledgeNavigation(request.id, file.path)
      } catch (error) {
        consumedNavigationRef.current.delete(key)
        throw error
      }
    },
    [editorSessionId, file.path, onAcknowledgeNavigation],
  )

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

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    syncDiagnosticMarkers(editor, monaco)
  }, [diagnostics, file.path, syncDiagnosticMarkers])

  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return
    consumeSourceNavigation(editor, monaco)
  }, [consumeSourceNavigation, file.path, highlights, navigationRequest])

  useEffect(
    () => () => {
      atomicChangePendingRef.current = false
      tabRegistrationRef.current?.dispose()
      tabRegistrationRef.current = null
      historyRegistrationRef.current?.dispose()
      historyRegistrationRef.current = null
      modelListenerRef.current?.dispose()
      modelListenerRef.current = null
      const markerModel = markerModelRef.current
      if (markerModel && monacoRef.current) {
        monacoRef.current.editor.setModelMarkers(
          markerModel,
          SCHEMA_DIAGNOSTIC_MARKER_OWNER,
          [],
        )
      }
      markerModelRef.current = null
      editorRef.current = null
      monacoRef.current = null
    },
    [],
  )

  return (
    <div
      className="editor-pane"
      style={
        problemPanel ? { gridTemplateRows: '37px auto minmax(0, 1fr)' } : undefined
      }
    >
      <div className="editor-filebar">
        <div>
          <FileCode2 size={13} />
          <span>{file.path}</span>
        </div>
        {statusLabel && <span className="parse-indicator">{statusLabel}</span>}
      </div>
      {problemPanel}
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
              const configureIndentation = (): void => {
                editor.getModel()?.updateOptions({
                  tabSize: 2,
                  indentSize: 2,
                  insertSpaces: true,
                })
              }
              editorRef.current = editor
              monacoRef.current = monaco
              configureIndentation()
              decorationsRef.current = applySourceHighlights(
                editor,
                monaco,
                highlights,
                decorationsRef.current,
              )
              syncDiagnosticMarkers(editor, monaco)
              consumeSourceNavigation(editor, monaco)
              registerTabAction(editor, monaco)
              registerHistoryActions(editor, monaco)
              modelListenerRef.current?.dispose()
              modelListenerRef.current = editor.onDidChangeModel(() => {
                configureIndentation()
                registerTabAction(editor, monaco)
                syncDiagnosticMarkers(editor, monaco)
                consumeSourceNavigation(editor, monaco)
              })
            }}
            onChange={(value) => {
              const atomic = atomicChangePendingRef.current
              atomicChangePendingRef.current = false
              onChange(value ?? '', atomic ? { atomic: true } : undefined)
            }}
            options={{
              automaticLayout: true,
              ariaLabel: `Schema editor: ${file.path}`,
              detectIndentation: false,
              editContext: false,
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: 12.5,
              insertSpaces: true,
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
              tabSize: 2,
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
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const focusNodeFromNavigation = useEditorStore(
    (state) => state.focusNodeFromNavigation,
  )
  const openTour = useEditorStore((state) => state.openTour)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedFieldId = useEditorStore((state) => state.selectedFieldId)
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId)
  const selectedEdgeAnchorFieldId = useEditorStore(
    (state) => state.selectedEdgeAnchorFieldId,
  )
  const parseState = useEditorStore((state) => state.parseState)
  const sourceNavigationRequest = useEditorStore(
    (state) => state.sourceNavigationRequest,
  )
  const editorSessionId = useEditorStore((state) => state.editorSessionId)
  const acknowledgeSourceNavigation = useEditorStore(
    (state) => state.acknowledgeSourceNavigation,
  )
  const navigateToDiagnostic = useEditorStore((state) => state.navigateToDiagnostic)
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
      const endpointFields = [selectedRelation.source, selectedRelation.target].flatMap(
        (endpoint) =>
          endpoint.fieldIds.map((fieldId, index) => ({
            fieldId,
            source: endpoint.sources[index],
          })),
      )
      const anchor = endpointFields.find(
        (entry) => entry.fieldId === selectedEdgeAnchorFieldId,
      )

      if (anchor?.source?.range) {
        append(anchor.source.filePath, anchor.source.range, 'selection')
        endpointFields.forEach((entry) => {
          if (entry.fieldId !== anchor.fieldId) {
            append(entry.source?.filePath, entry.source?.range, 'peer')
          }
        })
      } else {
        selectedRelation.source.sources.forEach((source) =>
          append(source.filePath, source.range, 'selection'),
        )
        selectedRelation.target.sources.forEach((source) =>
          append(source.filePath, source.range, 'peer'),
        )
      }
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
  }, [selectedDeclaration, selectedEdgeAnchorFieldId, selectedField, selectedRelation])
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
        : parseState.status === 'error'
          ? '解析服务异常'
          : parseState.status === 'valid'
            ? '结构有效'
            : '等待解析'

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
              diagnostics={parseState.diagnostics}
              navigationRequest={sourceNavigationRequest}
              editorSessionId={editorSessionId}
              problemPanel={
                index === 0 && parseState.diagnostics.length ? (
                  <ProblemsPanel
                    diagnostics={parseState.diagnostics}
                    onNavigate={navigateToDiagnostic}
                  />
                ) : undefined
              }
              theme={theme}
              statusLabel={index === 0 ? statusLabel : '关系另一端'}
              onUndo={undo}
              onRedo={redo}
              onAcknowledgeNavigation={acknowledgeSourceNavigation}
              onChange={(content, options) => {
                void updateFileContent(file.path, content, options)
              }}
            />
          ))
        ) : (
          <div className="empty-pane">
            {parseState.diagnostics.length ? (
              <ProblemsPanel
                diagnostics={parseState.diagnostics}
                onNavigate={navigateToDiagnostic}
              />
            ) : null}
            <span>项目中没有 Schema 文件</span>
          </div>
        )}
      </div>
    </section>
  )
}
