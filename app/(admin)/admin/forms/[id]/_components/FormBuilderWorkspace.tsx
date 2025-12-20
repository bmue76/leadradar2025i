'use client';

import * as React from 'react';
import { adminFetch } from '../../../_lib/adminFetch';

import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Form = any;
type Field = any;

const KEY_REGEX = /^[A-Za-z0-9_-]+$/;

function pickName(f: Form): string {
  return f?.name ?? f?.title ?? f?.label ?? f?.slug ?? 'Form';
}

function pickDescription(f: Form): string {
  const d = f?.description;
  return typeof d === 'string' ? d : '';
}

function pickStatus(f: Form): string {
  return String(f?.status ?? f?.formStatus ?? 'UNKNOWN');
}

function normalizeForm(rawData: any): Form {
  const d = rawData;
  if (d?.form) return d.form;
  if (d?.item) return d.item;
  return d;
}

function normalizeFields(rawData: any): Field[] {
  const d = rawData;
  if (Array.isArray(d?.fields)) return d.fields;
  if (Array.isArray(d?.form?.fields)) return d.form.fields;
  if (Array.isArray(d?.items)) return d.items;
  if (Array.isArray(d?.formFields)) return d.formFields;
  return [];
}

function fieldOrderValue(field: Field): number {
  const v =
    field?.sortOrder ??
    field?.order ??
    field?.position ??
    field?.sortIndex ??
    field?.index;

  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return 999999;
}

function pickFieldId(field: Field): string {
  return String(field?.id ?? '');
}

function pickFieldLabel(field: Field): string {
  return field?.label ?? field?.name ?? field?.title ?? field?.key ?? 'Field';
}

function pickFieldKey(field: Field): string {
  return field?.key ?? field?.fieldKey ?? '';
}

function pickFieldType(field: Field): string {
  return String(field?.type ?? field?.fieldType ?? 'TEXT');
}

function pickFieldRequired(field: Field): boolean {
  const v = field?.required ?? field?.isRequired;
  return typeof v === 'boolean' ? v : false;
}

function pickFieldActive(field: Field): boolean {
  const v = field?.isActive ?? field?.active;
  return typeof v === 'boolean' ? v : true;
}

function pickFieldPlaceholder(field: Field): string {
  return typeof field?.placeholder === 'string' ? field.placeholder : '';
}

function pickFieldHelpText(field: Field): string {
  return typeof field?.helpText === 'string' ? field.helpText : '';
}

function suggestKeyFromLabel(label: string): string {
  const raw = String(label || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status || 'UNKNOWN').toUpperCase();
  const base = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium';
  const style =
    s === 'ACTIVE'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : s === 'DRAFT'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : s === 'ARCHIVED'
          ? 'border-slate-200 bg-slate-50 text-slate-700'
          : 'border-slate-200 bg-white text-slate-700';
  return <span className={`${base} ${style}`}>{s}</span>;
}

function nextPrimaryAction(status: string): { label: string; toStatus: 'DRAFT' | 'ACTIVE' } | null {
  const s = String(status || 'UNKNOWN').toUpperCase();
  if (s === 'DRAFT') return { label: 'Aktivieren', toStatus: 'ACTIVE' };
  if (s === 'ACTIVE') return { label: 'Deaktivieren', toStatus: 'DRAFT' };
  if (s === 'ARCHIVED') return { label: 'Reaktivieren', toStatus: 'ACTIVE' };
  return null;
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-xl rounded-xl border bg-white shadow-lg">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div>
            <div className="text-lg font-semibold">{title}</div>
            <div className="mt-1 text-xs text-slate-600">
              Key-Format:{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5">A-Za-z0-9_-</code>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-2 py-1 text-sm hover:bg-slate-50"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

type Option = { label: string; value: string };

function optionsTextFromConfig(config: any): string {
  const opts = config?.options;
  if (!opts) return '';
  if (Array.isArray(opts)) {
    // string[] or {label,value}[]
    const lines = opts
      .map((o: any) => {
        if (typeof o === 'string') return o.trim();
        if (o && typeof o === 'object') return String(o.label ?? o.value ?? '').trim();
        return '';
      })
      .filter(Boolean);
    return lines.join('\n');
  }
  return '';
}

function optionsFromText(text: string): Option[] {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // de-dupe (case sensitive)
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const l of lines) {
    if (seen.has(l)) continue;
    seen.add(l);
    out.push({ label: l, value: l });
  }
  return out;
}

type CreateDraft = {
  label: string;
  key: string;
  type: string;
  required: boolean;
  isActive: boolean;
  placeholder: string;
  helpText: string;
};

function makeEmptyCreateDraft(): CreateDraft {
  return {
    label: '',
    key: '',
    type: 'TEXT',
    required: false,
    isActive: true,
    placeholder: '',
    helpText: '',
  };
}

type SelectedDraft = {
  label: string;
  key: string;
  type: string;
  required: boolean;
  isActive: boolean;
  placeholder: string;
  helpText: string;
  optionsText: string; // for SELECT/MULTISELECT
};

function draftFromField(f: Field): SelectedDraft {
  const type = pickFieldType(f);
  return {
    label: pickFieldLabel(f),
    key: pickFieldKey(f),
    type,
    required: pickFieldRequired(f),
    isActive: pickFieldActive(f),
    placeholder: pickFieldPlaceholder(f),
    helpText: pickFieldHelpText(f),
    optionsText: optionsTextFromConfig(f?.config),
  };
}

function isSelectType(type: string): boolean {
  const t = String(type || '').toUpperCase();
  return t === 'SELECT' || t === 'MULTISELECT';
}

function SortHandle({
  listeners,
  attributes,
  disabled,
}: {
  listeners: any;
  attributes: any;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="mr-2 rounded border bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      title="Drag to reorder"
      {...listeners}
      {...attributes}
      onClick={(e) => e.preventDefault()}
    >
      ☰
    </button>
  );
}

function SortableFieldRow({
  field,
  selected,
  onSelect,
  onToggleActive,
  onToggleRequired,
  busy,
}: {
  field: Field;
  selected: boolean;
  onSelect: () => void;
  onToggleActive: (next: boolean) => void;
  onToggleRequired: (next: boolean) => void;
  busy: boolean;
}) {
  const id = pickFieldId(field);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const active = pickFieldActive(field);
  const required = pickFieldRequired(field);
  const label = pickFieldLabel(field);
  const type = pickFieldType(field);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        'flex items-center gap-2 rounded-lg border p-2 text-sm',
        selected ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50',
        !active ? 'opacity-70' : '',
        isDragging ? 'shadow-md' : '',
      ].join(' ')}
    >
      <SortHandle listeners={listeners} attributes={attributes} disabled={busy} />

      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onSelect}
        title={id}
      >
        <div className="truncate font-medium text-slate-900">
          {label}
          {required ? <span className="ml-1 text-red-600">*</span> : null}
        </div>
        <div className="mt-0.5 truncate text-xs text-slate-600">
          <span className="font-mono">{pickFieldKey(field) || '—'}</span> · {String(type).toUpperCase()}
        </div>
      </button>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-slate-700" title="Aktiv">
          <input
            type="checkbox"
            checked={active}
            disabled={busy}
            onChange={(e) => onToggleActive(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
          aktiv
        </label>

        <label className="flex items-center gap-1 text-xs text-slate-700" title="Required">
          <input
            type="checkbox"
            checked={required}
            disabled={busy}
            onChange={(e) => onToggleRequired(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
          req
        </label>
      </div>
    </div>
  );
}

function PreviewField({ field }: { field: Field }) {
  const type = String(pickFieldType(field)).toUpperCase();
  const label = pickFieldLabel(field);
  const required = pickFieldRequired(field);
  const isActive = pickFieldActive(field);
  const placeholder = pickFieldPlaceholder(field);
  const helpText = pickFieldHelpText(field);
  const config = field?.config ?? {};
  const options: any[] = Array.isArray(config?.options) ? config.options : [];

  const commonLabel = (
    <div className="mb-1 flex items-center justify-between">
      <div className="text-sm font-medium text-slate-900">
        {label} {required ? <span className="text-red-600">*</span> : null}
      </div>
      {!isActive ? <div className="text-xs text-slate-500">inactive</div> : null}
    </div>
  );

  const commonHelp = helpText ? <div className="mt-1 text-xs text-slate-600">{helpText}</div> : null;

  if (type === 'TEXTAREA') {
    return (
      <div className="rounded-lg border bg-white p-3">
        {commonLabel}
        <textarea
          disabled
          placeholder={placeholder || ''}
          className="w-full resize-none rounded-md border px-3 py-2 text-sm"
          rows={3}
        />
        {commonHelp}
      </div>
    );
  }

  if (type === 'CHECKBOX') {
    return (
      <div className="rounded-lg border bg-white p-3">
        {commonLabel}
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input disabled type="checkbox" />
          <span className="text-slate-700">{placeholder || 'Checkbox'}</span>
        </label>
        {commonHelp}
      </div>
    );
  }

  if (type === 'SELECT') {
    return (
      <div className="rounded-lg border bg-white p-3">
        {commonLabel}
        <select disabled className="w-full rounded-md border px-3 py-2 text-sm">
          <option value="">{placeholder || 'Bitte wählen…'}</option>
          {options.map((o: any, idx: number) => {
            const lbl = typeof o === 'string' ? o : String(o?.label ?? o?.value ?? '');
            const val = typeof o === 'string' ? o : String(o?.value ?? o?.label ?? '');
            return (
              <option key={`${val}-${idx}`} value={val}>
                {lbl}
              </option>
            );
          })}
        </select>
        {commonHelp}
      </div>
    );
  }

  if (type === 'MULTISELECT') {
    // MVP: checkbox list
    return (
      <div className="rounded-lg border bg-white p-3">
        {commonLabel}
        <div className="space-y-2">
          {(options.length ? options : ['Option A', 'Option B']).map((o: any, idx: number) => {
            const lbl = typeof o === 'string' ? o : String(o?.label ?? o?.value ?? '');
            return (
              <label key={`${lbl}-${idx}`} className="flex items-center gap-2 text-sm text-slate-800">
                <input disabled type="checkbox" />
                <span className="text-slate-700">{lbl || `Option ${idx + 1}`}</span>
              </label>
            );
          })}
        </div>
        {commonHelp}
      </div>
    );
  }

  const inputType =
    type === 'EMAIL'
      ? 'email'
      : type === 'PHONE'
        ? 'tel'
        : type === 'NUMBER'
          ? 'number'
          : type === 'DATE'
            ? 'date'
            : type === 'DATETIME'
              ? 'datetime-local'
              : type === 'URL'
                ? 'url'
                : 'text';

  return (
    <div className="rounded-lg border bg-white p-3">
      {commonLabel}
      <input
        disabled
        type={inputType}
        placeholder={placeholder || ''}
        className="w-full rounded-md border px-3 py-2 text-sm"
      />
      {commonHelp}
    </div>
  );
}

export function FormBuilderWorkspace({ formId }: { formId: string }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [state, setState] = React.useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ok'; form: Form; fields: Field[]; raw: unknown }
    | { status: 'error'; message: string; raw?: unknown }
  >({ status: 'idle' });

  const [selectedFieldId, setSelectedFieldId] = React.useState<string>('');

  // Header/meta
  const [metaDraft, setMetaDraft] = React.useState({ name: '', description: '' });
  const metaSeedRef = React.useRef<string>('');
  const [metaBusy, setMetaBusy] = React.useState(false);
  const [metaError, setMetaError] = React.useState('');
  const [metaHint, setMetaHint] = React.useState('');

  const [statusBusy, setStatusBusy] = React.useState(false);
  const [statusError, setStatusError] = React.useState('');

  // Field create modal
  const [createModal, setCreateModal] = React.useState<null | { draft: CreateDraft; keyTouched: boolean }>(null);
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createError, setCreateError] = React.useState('');

  // Field list busy map (quick toggles / sorting)
  const [fieldBusyById, setFieldBusyById] = React.useState<Record<string, boolean>>({});
  const [fieldsError, setFieldsError] = React.useState('');
  const [sortBusy, setSortBusy] = React.useState(false);

  // Properties panel
  const [panelDraft, setPanelDraft] = React.useState<SelectedDraft | null>(null);
  const panelSeedRef = React.useRef<string>('');
  const [panelBusy, setPanelBusy] = React.useState(false);
  const [panelError, setPanelError] = React.useState('');
  const [panelHint, setPanelHint] = React.useState('');
  const [panelKeyTouched, setPanelKeyTouched] = React.useState(false);

  const fields = state.status === 'ok' ? state.fields : [];

  const selectedField: Field | null = React.useMemo(() => {
    if (state.status !== 'ok') return null;
    const f = state.fields.find((x) => pickFieldId(x) === selectedFieldId);
    return f ?? null;
  }, [state, selectedFieldId]);

  const formStatus = state.status === 'ok' ? pickStatus(state.form) : 'UNKNOWN';

  const metaDirty = React.useMemo(() => {
    const seed = metaSeedRef.current;
    const now = JSON.stringify(metaDraft);
    return seed !== '' && seed !== now;
  }, [metaDraft]);

  const panelDirty = React.useMemo(() => {
    const seed = panelSeedRef.current;
    const now = panelDraft ? JSON.stringify(panelDraft) : '';
    return seed !== '' && seed !== now;
  }, [panelDraft]);

  async function load() {
    setState({ status: 'loading' });

    const res = await adminFetch<any>(`/api/admin/v1/forms/${encodeURIComponent(formId)}`, {
      method: 'GET',
    });

    if (res.ok) {
      const form = normalizeForm(res.data);
      const sorted = normalizeFields(res.data)
        .slice()
        .sort((a, b) => {
          const ao = fieldOrderValue(a);
          const bo = fieldOrderValue(b);
          if (ao !== bo) return ao - bo;
          const ak = String(pickFieldKey(a) || '');
          const bk = String(pickFieldKey(b) || '');
          if (ak !== bk) return ak.localeCompare(bk);
          return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
        });

      setState({ status: 'ok', form, fields: sorted, raw: res.raw });

      // seed meta
      const m = { name: pickName(form), description: pickDescription(form) };
      setMetaDraft(m);
      metaSeedRef.current = JSON.stringify(m);

      // selection
      setSelectedFieldId((prev) => {
        if (prev && sorted.some((f) => pickFieldId(f) === prev)) return prev;
        return sorted.length ? pickFieldId(sorted[0]) : '';
      });

      return;
    }

    setState({
      status: 'error',
      message: res.error?.message ?? 'Unbekannter Fehler',
      raw: res.raw,
    });
  }

  async function patchForm(payload: any) {
    setMetaError('');
    setStatusError('');

    const res = await adminFetch<any>(`/api/admin/v1/forms/${encodeURIComponent(formId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    return res;
  }

  async function patchField(fieldId: string, payload: any) {
    const res = await adminFetch<any>(
      `/api/admin/v1/forms/${encodeURIComponent(formId)}/fields/${encodeURIComponent(fieldId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    return res;
  }

  async function createField(payload: any) {
    const res = await adminFetch<any>(`/api/admin/v1/forms/${encodeURIComponent(formId)}/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res;
  }

  function upsertFieldInState(nextField: Field) {
    setState((s) => {
      if (s.status !== 'ok') return s;
      const id = pickFieldId(nextField);
      const idx = s.fields.findIndex((f) => pickFieldId(f) === id);
      const next = idx >= 0 ? s.fields.map((f, i) => (i === idx ? nextField : f)) : [...s.fields, nextField];
      next.sort((a, b) => fieldOrderValue(a) - fieldOrderValue(b));
      return { ...s, fields: next };
    });
  }

  function replaceFieldsInState(nextFields: Field[]) {
    setState((s) => (s.status === 'ok' ? { ...s, fields: nextFields } : s));
  }

  async function onSaveMeta() {
    if (state.status !== 'ok') return;

    setMetaBusy(true);
    setMetaError('');
    setMetaHint('');

    const payload: any = {
      name: String(metaDraft.name || '').trim(),
      description: String(metaDraft.description || ''),
    };

    if (!payload.name) {
      setMetaBusy(false);
      setMetaError('Name ist erforderlich.');
      return;
    }

    const res = await patchForm(payload);

    if (!res.ok) {
      setMetaBusy(false);
      setMetaError(res.error?.message ?? 'Speichern fehlgeschlagen');
      return;
    }

    // Update local form (best-effort)
    setState((s) => {
      if (s.status !== 'ok') return s;
      const f = { ...(s.form ?? {}) };
      f.name = payload.name;
      f.description = payload.description;
      return { ...s, form: f };
    });

    metaSeedRef.current = JSON.stringify({ name: payload.name, description: payload.description });
    setMetaHint('Gespeichert');
    setTimeout(() => setMetaHint(''), 1200);
    setMetaBusy(false);
  }

  async function onToggleStatus() {
    if (state.status !== 'ok') return;

    const primary = nextPrimaryAction(formStatus);
    if (!primary) return;

    setStatusBusy(true);
    setStatusError('');

    const res = await patchForm({ status: primary.toStatus });

    if (!res.ok) {
      setStatusBusy(false);
      setStatusError(res.error?.message ?? 'Status-Update fehlgeschlagen');
      return;
    }

    // update local form status (best-effort)
    setState((s) => {
      if (s.status !== 'ok') return s;
      const f = { ...(s.form ?? {}) };
      f.status = primary.toStatus;
      return { ...s, form: f };
    });

    setStatusBusy(false);
  }

  function openCreateModal() {
    setCreateError('');
    setCreateModal({ draft: makeEmptyCreateDraft(), keyTouched: false });
  }

  async function onCreateField() {
    if (!createModal) return;

    setCreateBusy(true);
    setCreateError('');

    const draft = createModal.draft;
    const label = String(draft.label || '').trim();
    const key = String(draft.key || '').trim();
    const type = String(draft.type || 'TEXT').toUpperCase();

    if (!label) {
      setCreateBusy(false);
      setCreateError('Label ist erforderlich.');
      return;
    }
    if (!key) {
      setCreateBusy(false);
      setCreateError('Key ist erforderlich.');
      return;
    }
    if (!KEY_REGEX.test(key)) {
      setCreateBusy(false);
      setCreateError('Key ungültig. Erlaubt: A–Z a–z 0–9 _ -');
      return;
    }

    const payload: any = {
      label,
      key,
      type,
      required: !!draft.required,
      isActive: !!draft.isActive,
      placeholder: String(draft.placeholder || ''),
      helpText: String(draft.helpText || ''),
    };

    const res = await createField(payload);

    if (!res.ok) {
      const code = String(res.error?.code ?? '').toUpperCase();
      if (code === 'KEY_CONFLICT') {
        setCreateBusy(false);
        setCreateError('Dieser Key ist bereits vorhanden. Bitte wähle einen anderen.');
        return;
      }
      setCreateBusy(false);
      setCreateError(res.error?.message ?? 'Create fehlgeschlagen');
      return;
    }

    // best-effort: find created field in response
    const created: Field | null =
      res.data?.field ?? res.data?.item ?? (res.data && (res.data.id || res.data.key) ? res.data : null);

    if (created) {
      setState((s) => {
        if (s.status !== 'ok') return s;
        const next = [...s.fields, created].slice().sort((a, b) => fieldOrderValue(a) - fieldOrderValue(b));
        return { ...s, fields: next };
      });
      setSelectedFieldId(pickFieldId(created));
    } else {
      // fallback: reload
      await load();
    }

    setCreateBusy(false);
    setCreateModal(null);
  }

  async function quickToggle(field: Field, patch: any) {
    const id = pickFieldId(field);
    setFieldsError('');
    setFieldBusyById((m) => ({ ...m, [id]: true }));

    // optimistic
    const prev = field;
    const optimistic = { ...(field ?? {}), ...patch };
    upsertFieldInState(optimistic);

    const res = await patchField(id, patch);

    if (!res.ok) {
      // revert
      upsertFieldInState(prev);
      setFieldsError(res.error?.message ?? 'Update fehlgeschlagen');
    } else {
      const updated: Field | null =
        res.data?.field ?? res.data?.item ?? (res.data && (res.data.id || res.data.key) ? res.data : null);
      if (updated) upsertFieldInState(updated);
    }

    setFieldBusyById((m) => ({ ...m, [id]: false }));
  }

  async function onDragEnd(e: DragEndEvent) {
    if (state.status !== 'ok') return;
    if (sortBusy) return;

    const activeId = String(e.active?.id ?? '');
    const overId = String(e.over?.id ?? '');
    if (!activeId || !overId || activeId === overId) return;

    const oldIndex = state.fields.findIndex((f) => pickFieldId(f) === activeId);
    const newIndex = state.fields.findIndex((f) => pickFieldId(f) === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    setFieldsError('');
    setSortBusy(true);

    const prevFields = state.fields;
    const reordered = arrayMove(prevFields, oldIndex, newIndex);

    // normalize sortOrder to 1..n
    const normalized = reordered.map((f, idx) => {
      const nextOrder = idx + 1;
      const cur = fieldOrderValue(f);
      if (cur === nextOrder) return f;
      return { ...(f ?? {}), sortOrder: nextOrder };
    });

    replaceFieldsInState(normalized);

    // patch only changed
    const changed = normalized.filter((f) => {
      const id = pickFieldId(f);
      const prev = prevFields.find((x) => pickFieldId(x) === id);
      if (!prev) return true;
      return fieldOrderValue(prev) !== fieldOrderValue(f);
    });

    try {
      for (const f of changed) {
        const id = pickFieldId(f);
        const res = await patchField(id, { sortOrder: fieldOrderValue(f) });
        if (!res.ok) {
          throw new Error(res.error?.message ?? 'Sort persist failed');
        }
      }
      setSortBusy(false);
    } catch (err: any) {
      // revert
      replaceFieldsInState(prevFields);
      setSortBusy(false);
      setFieldsError(String(err?.message ?? 'Sortierung fehlgeschlagen'));
    }
  }

  function ensurePanelSeedFromSelected(f: Field | null) {
    if (!f) {
      setPanelDraft(null);
      panelSeedRef.current = '';
      setPanelKeyTouched(false);
      return;
    }

    const d = draftFromField(f);
    setPanelDraft(d);
    panelSeedRef.current = JSON.stringify(d);
    setPanelError('');
    setPanelHint('');
    setPanelKeyTouched(false);
  }

  async function onSavePanel() {
    if (!selectedField || !panelDraft) return;

    setPanelBusy(true);
    setPanelError('');
    setPanelHint('');

    const label = String(panelDraft.label || '').trim();
    const key = String(panelDraft.key || '').trim();
    const type = String(panelDraft.type || 'TEXT').toUpperCase();

    if (!label) {
      setPanelBusy(false);
      setPanelError('Label ist erforderlich.');
      return;
    }
    if (!key) {
      setPanelBusy(false);
      setPanelError('Key ist erforderlich.');
      return;
    }
    if (!KEY_REGEX.test(key)) {
      setPanelBusy(false);
      setPanelError('Key ungültig. Erlaubt: A–Z a–z 0–9 _ -');
      return;
    }

    const payload: any = {
      label,
      key,
      type,
      required: !!panelDraft.required,
      isActive: !!panelDraft.isActive,
      placeholder: String(panelDraft.placeholder || ''),
      helpText: String(panelDraft.helpText || ''),
    };

    // config options for select/multiselect
    if (isSelectType(type)) {
      const prevConfig = selectedField?.config && typeof selectedField.config === 'object' ? selectedField.config : {};
      payload.config = { ...prevConfig, options: optionsFromText(panelDraft.optionsText) };
    }

    const id = pickFieldId(selectedField);
    const res = await patchField(id, payload);

    if (!res.ok) {
      const code = String(res.error?.code ?? '').toUpperCase();
      if (code === 'KEY_CONFLICT') {
        setPanelBusy(false);
        setPanelError('Dieser Key ist bereits vorhanden. Bitte wähle einen anderen.');
        return;
      }
      setPanelBusy(false);
      setPanelError(res.error?.message ?? 'Speichern fehlgeschlagen');
      return;
    }

    const updated: Field | null =
      res.data?.field ?? res.data?.item ?? (res.data && (res.data.id || res.data.key) ? res.data : null);

    if (updated) {
      upsertFieldInState(updated);
      ensurePanelSeedFromSelected(updated);
    } else {
      // fallback reload
      await load();
    }

    setPanelHint('Gespeichert');
    setTimeout(() => setPanelHint(''), 1200);
    setPanelBusy(false);
  }

  function onResetPanel() {
    if (!selectedField) return;
    ensurePanelSeedFromSelected(selectedField);
  }

  React.useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  React.useEffect(() => {
    // whenever selection changes, seed panel
    ensurePanelSeedFromSelected(selectedField);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFieldId]);

  return (
    <div className="space-y-4">
      {/* Top header: Form meta + status */}
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="text-lg font-semibold text-slate-900">Form Builder</div>
              <StatusBadge status={formStatus} />
              {sortBusy ? <span className="text-xs text-slate-500">Sortierung wird gespeichert…</span> : null}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-700">Name</label>
                <input
                  value={metaDraft.name}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, name: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="Form Name"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700">Description (optional)</label>
                <input
                  value={metaDraft.description}
                  onChange={(e) => setMetaDraft((d) => ({ ...d, description: e.target.value }))}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="Kurzbeschreibung"
                />
              </div>
            </div>

            {metaError ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                {metaError}
              </div>
            ) : null}

            {metaHint ? <div className="mt-3 text-sm text-emerald-700">{metaHint}</div> : null}
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
            >
              Refresh
            </button>

            <button
              type="button"
              onClick={() => void onSaveMeta()}
              disabled={metaBusy || !metaDirty}
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              title={!metaDirty ? 'Keine Änderungen' : 'Meta speichern'}
            >
              {metaBusy ? 'Speichern…' : 'Meta speichern'}
            </button>

            <button
              type="button"
              onClick={() => void onToggleStatus()}
              disabled={statusBusy || !nextPrimaryAction(formStatus)}
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              title="Status togglen"
            >
              {statusBusy ? 'Speichern…' : nextPrimaryAction(formStatus)?.label ?? '—'}
            </button>

            {statusError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                {statusError}
              </div>
            ) : null}
          </div>
        </div>

        {state.status === 'loading' || state.status === 'idle' ? (
          <div className="mt-4 text-sm text-slate-600">Lade…</div>
        ) : state.status === 'error' ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <div className="font-medium">Fehler</div>
            <div className="mt-1">{state.message}</div>
            {state.raw ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs">Raw response</summary>
                <pre className="mt-2 overflow-auto rounded bg-white p-2 text-xs text-slate-800">
                  {JSON.stringify(state.raw, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Workspace panes */}
      {state.status === 'ok' ? (
        <section className="grid gap-4 lg:grid-cols-[320px_1fr_380px]">
          {/* Left Pane */}
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Fields</div>
                <div className="mt-0.5 text-xs text-slate-600">
                  Drag & Drop · Quick toggles · Auswahl
                </div>
              </div>

              <button
                type="button"
                onClick={openCreateModal}
                className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
              >
                + Feld
              </button>
            </div>

            {fieldsError ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                {fieldsError}
              </div>
            ) : null}

            <div className="mt-3">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={fields.map((f) => pickFieldId(f))} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {fields.map((f) => {
                      const id = pickFieldId(f);
                      const busy = !!fieldBusyById[id] || sortBusy;
                      return (
                        <SortableFieldRow
                          key={id}
                          field={f}
                          selected={id === selectedFieldId}
                          busy={busy}
                          onSelect={() => setSelectedFieldId(id)}
                          onToggleActive={(next) => void quickToggle(f, { isActive: next })}
                          onToggleRequired={(next) => void quickToggle(f, { required: next })}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>

              {!fields.length ? (
                <div className="mt-3 rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
                  Noch keine Felder. Klicke <span className="font-medium">+ Feld</span>.
                </div>
              ) : null}
            </div>
          </div>

          {/* Center Pane */}
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Preview</div>
                <div className="mt-0.5 text-xs text-slate-600">Read-only · Reihenfolge = sortOrder</div>
              </div>
              <div className="text-xs text-slate-500">Fields: {fields.length}</div>
            </div>

            <div className="mt-3 space-y-3">
              {fields.length ? (
                fields.map((f) => (
                  <div
                    key={pickFieldId(f)}
                    className={pickFieldId(f) === selectedFieldId ? 'ring-2 ring-slate-300 rounded-lg' : ''}
                    onClick={() => setSelectedFieldId(pickFieldId(f))}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedFieldId(pickFieldId(f));
                    }}
                  >
                    <PreviewField field={f} />
                  </div>
                ))
              ) : (
                <div className="rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
                  Kein Preview möglich: noch keine Felder.
                </div>
              )}
            </div>
          </div>

          {/* Right Pane */}
          <div className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Properties</div>
                <div className="mt-0.5 text-xs text-slate-600">
                  Auswahl: <span className="font-mono">{selectedFieldId || '—'}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onResetPanel}
                  disabled={!panelDirty || panelBusy}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => void onSavePanel()}
                  disabled={!panelDirty || panelBusy || !panelDraft}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {panelBusy ? 'Speichern…' : 'Save'}
                </button>
              </div>
            </div>

            {!selectedField || !panelDraft ? (
              <div className="mt-3 rounded-lg border bg-slate-50 p-3 text-sm text-slate-700">
                Wähle links ein Field aus.
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="text-xs font-medium text-slate-700">Label *</label>
                    <input
                      value={panelDraft.label}
                      onChange={(e) => {
                        const nextLabel = e.target.value;
                        setPanelDraft((d) => (d ? { ...d, label: nextLabel } : d));
                        if (!panelKeyTouched) {
                          const suggested = suggestKeyFromLabel(nextLabel);
                          setPanelDraft((d) => (d ? { ...d, key: suggested } : d));
                        }
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-medium text-slate-700">Key *</label>
                    <input
                      value={panelDraft.key}
                      onChange={(e) => {
                        setPanelKeyTouched(true);
                        setPanelDraft((d) => (d ? { ...d, key: e.target.value } : d));
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono"
                    />
                    <div className="mt-1 text-xs text-slate-600">
                      Regex: <code className="rounded bg-slate-100 px-1 py-0.5">^[A-Za-z0-9_-]+$</code>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-700">Type</label>
                    <select
                      value={panelDraft.type}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        setPanelDraft((d) => (d ? { ...d, type: nextType } : d));
                      }}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    >
                      {[
                        'TEXT',
                        'TEXTAREA',
                        'EMAIL',
                        'PHONE',
                        'NUMBER',
                        'CHECKBOX',
                        'DATE',
                        'DATETIME',
                        'URL',
                        'SELECT',
                        'MULTISELECT',
                      ].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={panelDraft.isActive}
                        onChange={(e) => setPanelDraft((d) => (d ? { ...d, isActive: e.target.checked } : d))}
                      />
                      aktiv
                    </label>

                    <label className="flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={panelDraft.required}
                        onChange={(e) => setPanelDraft((d) => (d ? { ...d, required: e.target.checked } : d))}
                      />
                      required
                    </label>
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-medium text-slate-700">Placeholder</label>
                    <input
                      value={panelDraft.placeholder}
                      onChange={(e) => setPanelDraft((d) => (d ? { ...d, placeholder: e.target.value } : d))}
                      className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-medium text-slate-700">HelpText</label>
                    <textarea
                      value={panelDraft.helpText}
                      onChange={(e) => setPanelDraft((d) => (d ? { ...d, helpText: e.target.value } : d))}
                      className="mt-1 w-full resize-none rounded-md border px-3 py-2 text-sm"
                      rows={3}
                    />
                  </div>

                  {isSelectType(panelDraft.type) ? (
                    <div className="md:col-span-2">
                      <label className="text-xs font-medium text-slate-700">Options (1 pro Zeile)</label>
                      <textarea
                        value={panelDraft.optionsText}
                        onChange={(e) => setPanelDraft((d) => (d ? { ...d, optionsText: e.target.value } : d))}
                        className="mt-1 w-full resize-none rounded-md border px-3 py-2 text-sm font-mono"
                        rows={6}
                        placeholder={'Option 1\nOption 2\nOption 3'}
                      />
                      <div className="mt-1 text-xs text-slate-600">
                        Wird als <code className="rounded bg-slate-100 px-1 py-0.5">config.options</code> persistiert.
                      </div>
                    </div>
                  ) : null}
                </div>

                {panelError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                    {panelError}
                  </div>
                ) : null}

                {panelHint ? <div className="text-sm text-emerald-700">{panelHint}</div> : null}

                {panelDirty ? (
                  <div className="text-xs text-slate-500">
                    Änderungen nicht gespeichert.
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">Keine Änderungen.</div>
                )}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* Create Field Modal */}
      {createModal ? (
        <ModalShell title="Neues Field" onClose={() => setCreateModal(null)}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-700">Label *</label>
              <input
                value={createModal.draft.label}
                onChange={(e) => {
                  const label = e.target.value;
                  setCreateModal((m) => {
                    if (!m) return m;
                    const key = m.keyTouched ? m.draft.key : suggestKeyFromLabel(label);
                    return { ...m, draft: { ...m.draft, label, key } };
                  });
                }}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-700">Key *</label>
              <input
                value={createModal.draft.key}
                onChange={(e) => {
                  const key = e.target.value;
                  setCreateModal((m) => (m ? { ...m, keyTouched: true, draft: { ...m.draft, key } } : m));
                }}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Type</label>
              <select
                value={createModal.draft.type}
                onChange={(e) =>
                  setCreateModal((m) => (m ? { ...m, draft: { ...m.draft, type: e.target.value } } : m))
                }
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              >
                {[
                  'TEXT',
                  'TEXTAREA',
                  'EMAIL',
                  'PHONE',
                  'NUMBER',
                  'CHECKBOX',
                  'DATE',
                  'DATETIME',
                  'URL',
                  'SELECT',
                  'MULTISELECT',
                ].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={createModal.draft.isActive}
                  onChange={(e) =>
                    setCreateModal((m) =>
                      m ? { ...m, draft: { ...m.draft, isActive: e.target.checked } } : m,
                    )
                  }
                />
                aktiv
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={createModal.draft.required}
                  onChange={(e) =>
                    setCreateModal((m) =>
                      m ? { ...m, draft: { ...m.draft, required: e.target.checked } } : m,
                    )
                  }
                />
                required
              </label>
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-700">Placeholder</label>
              <input
                value={createModal.draft.placeholder}
                onChange={(e) =>
                  setCreateModal((m) => (m ? { ...m, draft: { ...m.draft, placeholder: e.target.value } } : m))
                }
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-700">HelpText</label>
              <textarea
                value={createModal.draft.helpText}
                onChange={(e) =>
                  setCreateModal((m) => (m ? { ...m, draft: { ...m.draft, helpText: e.target.value } } : m))
                }
                className="mt-1 w-full resize-none rounded-md border px-3 py-2 text-sm"
                rows={3}
              />
            </div>
          </div>

          {createError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              {createError}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateModal(null)}
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
              disabled={createBusy}
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => void onCreateField()}
              className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={createBusy}
            >
              {createBusy ? 'Erstellen…' : 'Erstellen'}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
