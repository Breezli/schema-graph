import {
  Braces,
  ChevronRight,
  Database,
  Link2,
  Palette,
  Plus,
  SlidersHorizontal,
  Table2,
  Trash2,
} from 'lucide-react'
import { Tabs } from 'radix-ui'
import { type FormEvent, useState } from 'react'

import type { ModelDeclaration, SchemaDeclaration, SchemaField } from '@/domain/schema'
import { useEditorStore } from '@/state'

type VisualDeclaration = Exclude<SchemaDeclaration, { readonly kind: 'commentBlock' }>

function FieldEditor({
  modelId,
  field,
}: {
  readonly modelId: string
  readonly field: SchemaField
}) {
  const updateField = useEditorStore((state) => state.updateField)
  const deleteField = useEditorStore((state) => state.deleteField)
  const [name, setName] = useState(field.name)
  const [typeName, setTypeName] = useState(field.type.name)

  function save(): void {
    if (name !== field.name || typeName !== field.type.name) {
      updateField(modelId, field.id, { name, typeName })
    }
  }

  return (
    <div className="field-editor-row">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        aria-label={`${field.name} 字段名称`}
      />
      <input
        className="field-type-input"
        value={typeName}
        onChange={(event) => setTypeName(event.target.value)}
        onBlur={save}
        aria-label={`${field.name} 字段类型`}
      />
      <span className="field-modifier">
        {field.type.modifier === 'list'
          ? '[]'
          : field.type.modifier === 'optional'
            ? '?'
            : '—'}
      </span>
      <button
        type="button"
        aria-label={`删除字段 ${field.name}`}
        onClick={() => {
          if (window.confirm(`确定删除字段“${field.name}”吗？`)) {
            deleteField(modelId, field.id)
          }
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function ModelProperties({ model }: { readonly model: ModelDeclaration }) {
  const renameModel = useEditorStore((state) => state.renameModel)
  const addField = useEditorStore((state) => state.addField)
  const [name, setName] = useState(model.name)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState('String')
  const fields = model.members.filter((member) => member.kind === 'field')

  function submitField(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!newFieldName.trim()) return
    addField(model.id, newFieldName, newFieldType)
    setNewFieldName('')
  }

  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <label htmlFor="model-name">模型名称</label>
        <input
          id="model-name"
          className="inspector-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name !== model.name) renameModel(model.id, name)
          }}
        />
        <div className="source-reference">
          {model.source.filePath} <ChevronRight size={11} /> model
        </div>
      </section>

      <section className="inspector-section fields-section">
        <div className="inspector-section-title">
          <span>字段</span>
          <small>{fields.length}</small>
        </div>
        <div className="field-editor-head">
          <span>名称</span>
          <span>类型</span>
          <span />
          <span />
        </div>
        <div className="field-editor-list">
          {fields.map((field) => (
            <FieldEditor
              key={`${field.id}:${field.name}:${field.type.name}`}
              modelId={model.id}
              field={field}
            />
          ))}
        </div>
        <form className="add-field-form" onSubmit={submitField}>
          <input
            value={newFieldName}
            onChange={(event) => setNewFieldName(event.target.value)}
            placeholder="字段名称"
            aria-label="新字段名称"
          />
          <input
            value={newFieldType}
            onChange={(event) => setNewFieldType(event.target.value)}
            placeholder="String"
            aria-label="新字段类型"
          />
          <button type="submit" aria-label="添加字段">
            <Plus size={14} />
          </button>
        </form>
      </section>
    </div>
  )
}

function RelationsPanel({ modelId }: { readonly modelId?: string }) {
  const relations = useEditorStore(
    (state) => state.parseState.lastValidSnapshot?.graph.logicalRelations ?? [],
  )
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId)
  const setSelectedEdge = useEditorStore((state) => state.setSelectedEdge)
  const connectModels = useEditorStore((state) => state.connectModels)
  const declarations = useEditorStore(
    (state) => state.parseState.lastValidSnapshot?.graph.declarations ?? [],
  )
  const targets = declarations.filter(
    (declaration): declaration is ModelDeclaration =>
      declaration.kind === 'model' || declaration.kind === 'view',
  )
  const [targetModelId, setTargetModelId] = useState('')
  const selectedTargetId = targets.some((target) => target.id === targetModelId)
    ? targetModelId
    : (targets.find((target) => target.id !== modelId)?.id ?? targets[0]?.id ?? '')
  const visibleRelations = relations.filter(
    (relation) =>
      relation.id === selectedEdgeId ||
      relation.source.modelId === modelId ||
      relation.target.modelId === modelId,
  )

  return (
    <div className="relation-list">
      {modelId && selectedTargetId && (
        <form
          className="relation-create-form"
          onSubmit={(event) => {
            event.preventDefault()
            connectModels(modelId, selectedTargetId)
          }}
        >
          <label htmlFor="relation-target">新增一对多关系</label>
          <div>
            <select
              id="relation-target"
              value={selectedTargetId}
              onChange={(event) => setTargetModelId(event.target.value)}
            >
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
            <button type="submit">
              <Plus size={13} /> 创建
            </button>
          </div>
        </form>
      )}
      {visibleRelations.length ? (
        visibleRelations.map((relation) => (
          <button
            type="button"
            key={relation.id}
            className={relation.id === selectedEdgeId ? 'is-active' : ''}
            onClick={() => setSelectedEdge(relation.id)}
          >
            <span className="relation-route">
              {relation.source.modelName} <Link2 size={12} />{' '}
              {relation.target.modelName}
            </span>
            <strong>
              {relation.name ||
                `${relation.source.fieldNames.join(', ')} ↔ ${relation.target.fieldNames.join(', ')}`}
            </strong>
            <small>
              {relation.source.cardinality} ↔ {relation.target.cardinality}
              {relation.foreignKey
                ? ` · FK ${relation.foreignKey.fieldNames.join(', ')} → ${relation.foreignKey.referenceNames.join(', ')}`
                : ' · implicit relation'}
            </small>
          </button>
        ))
      ) : (
        <div className="inspector-empty small">
          <Link2 size={18} />
          <span>选择模型或关系线查看连接信息。</span>
        </div>
      )}
    </div>
  )
}

function AppearancePanel() {
  const density = useEditorStore((state) => state.density)
  const setDensity = useEditorStore((state) => state.setDensity)
  const edgeStyle = useEditorStore((state) => state.edgeStyle)
  const setEdgeStyle = useEditorStore((state) => state.setEdgeStyle)
  const relationLabelMode = useEditorStore((state) => state.relationLabelMode)
  const setRelationLabelMode = useEditorStore((state) => state.setRelationLabelMode)
  const relationNotation = useEditorStore((state) => state.relationNotation)
  const setRelationNotation = useEditorStore((state) => state.setRelationNotation)
  const highlightRequiredFields = useEditorStore(
    (state) => state.highlightRequiredFields,
  )
  const setHighlightRequiredFields = useEditorStore(
    (state) => state.setHighlightRequiredFields,
  )

  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <label>节点密度</label>
        <div className="segmented-control three">
          {(['overview', 'standard', 'full'] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={density === value ? 'is-active' : ''}
              onClick={() => setDensity(value)}
            >
              {value === 'overview' ? '概览' : value === 'standard' ? '标准' : '完整'}
            </button>
          ))}
        </div>
      </section>
      <section className="inspector-section">
        <label>关系线</label>
        <div className="segmented-control">
          <button
            type="button"
            className={edgeStyle === 'smoothstep' ? 'is-active' : ''}
            onClick={() => setEdgeStyle('smoothstep')}
          >
            直角
          </button>
          <button
            type="button"
            className={edgeStyle === 'bezier' ? 'is-active' : ''}
            onClick={() => setEdgeStyle('bezier')}
          >
            曲线
          </button>
        </div>
      </section>
      <section className="inspector-section">
        <label>关系标签</label>
        <div className="segmented-control three">
          {(['none', 'name', 'full'] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={relationLabelMode === value ? 'is-active' : ''}
              onClick={() => setRelationLabelMode(value)}
            >
              {value === 'none' ? '隐藏' : value === 'name' ? '名称' : '完整'}
            </button>
          ))}
        </div>
      </section>
      <section className="inspector-section">
        <label>关系基数</label>
        <div className="segmented-control">
          <button
            type="button"
            className={relationNotation === 'crowfoot' ? 'is-active' : ''}
            onClick={() => setRelationNotation('crowfoot')}
          >
            乌鸦脚
          </button>
          <button
            type="button"
            className={relationNotation === 'numeric' ? 'is-active' : ''}
            onClick={() => setRelationNotation('numeric')}
          >
            数字
          </button>
        </div>
      </section>
      <section className="inspector-section">
        <label>字段标识</label>
        <button
          type="button"
          className={`required-highlight-toggle ${highlightRequiredFields ? 'is-active' : ''}`}
          onClick={() => setHighlightRequiredFields(!highlightRequiredFields)}
        >
          <span />
          <div>
            <strong>高亮必填字段</strong>
            <small>非可选单值字段，列表除外</small>
          </div>
        </button>
      </section>
    </div>
  )
}

export function InspectorPanel() {
  const snapshot = useEditorStore((state) => state.parseState.lastValidSnapshot)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId)
  const selectedEdgeId = useEditorStore((state) => state.selectedEdgeId)
  const selectedDeclaration = snapshot?.graph.declarations.find(
    (declaration): declaration is VisualDeclaration =>
      declaration.kind !== 'commentBlock' && declaration.id === selectedNodeId,
  )
  const selectedModel =
    selectedDeclaration?.kind === 'model' ||
    selectedDeclaration?.kind === 'view' ||
    selectedDeclaration?.kind === 'type'
      ? selectedDeclaration
      : undefined

  return (
    <aside className="inspector-panel" aria-label="属性面板">
      <div className="inspector-heading">
        <div className="inspector-identity">
          <span className={`node-kind kind-${selectedDeclaration?.kind ?? 'none'}`}>
            {selectedDeclaration?.kind === 'enum' ? (
              <Braces size={14} />
            ) : selectedDeclaration?.kind === 'datasource' ||
              selectedDeclaration?.kind === 'generator' ? (
              <Database size={14} />
            ) : (
              <Table2 size={14} />
            )}
          </span>
          <div>
            <strong>
              {selectedDeclaration?.name ?? (selectedEdgeId ? '关系详情' : '项目属性')}
            </strong>
            <small>{selectedDeclaration?.kind ?? 'Schema Graph'}</small>
          </div>
        </div>
      </div>

      <Tabs.Root
        key={selectedEdgeId ?? selectedNodeId ?? 'project'}
        defaultValue={selectedEdgeId ? 'relations' : 'properties'}
      >
        <Tabs.List className="inspector-tabs" aria-label="属性类型">
          <Tabs.Trigger value="properties">
            <SlidersHorizontal size={13} /> 属性
          </Tabs.Trigger>
          <Tabs.Trigger value="relations">
            <Link2 size={13} /> 关系
          </Tabs.Trigger>
          <Tabs.Trigger value="appearance">
            <Palette size={13} /> 外观
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="properties" className="inspector-content">
          {selectedModel ? (
            <ModelProperties
              key={`${selectedModel.id}:${selectedModel.name}`}
              model={selectedModel}
            />
          ) : selectedDeclaration ? (
            <div className="readonly-declaration">
              <span>{selectedDeclaration.kind}</span>
              <strong>{selectedDeclaration.name}</strong>
              <small>{selectedDeclaration.source.filePath}</small>
              <p>配置节点和枚举可在代码编辑器中完整修改。</p>
            </div>
          ) : (
            <div className="inspector-empty">
              <Table2 size={22} />
              <strong>选择一个节点</strong>
              <span>模型名称、字段和约束会出现在这里。</span>
            </div>
          )}
        </Tabs.Content>
        <Tabs.Content value="relations" className="inspector-content">
          <RelationsPanel modelId={selectedModel?.id} />
        </Tabs.Content>
        <Tabs.Content value="appearance" className="inspector-content">
          <AppearancePanel />
        </Tabs.Content>
      </Tabs.Root>
    </aside>
  )
}
