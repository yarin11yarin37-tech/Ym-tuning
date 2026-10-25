/**
 * עוזר הכיול של YM.
 *
 * Two understanding engines:
 *  - 'local': deterministic Hebrew rule parser (always available, labelled as NOT AI).
 *  - 'ai':    an optional language model, used ONLY to turn free text into a structured
 *             ParsedRequest. Its output is validated, merged with the local safety rules, and
 *             then goes through exactly the same plan builder and support checks.
 * The assistant never produces calibration files or values on its own.
 */
import type { AssistantReply, AssistantStatus, ControllerKind, ParsedRequest } from '../../shared/workshop';
import type { Calibration } from './calibration';
import type { AuditLog } from './audit';
import { parseRequest } from '../calibration/request';
import { WorkshopError } from './errors';

export interface SecretStore {
  get(): string | null;
  set(value: string | null): void;
}

export interface AiSettings { model: string }
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

const INTENTS: ParsedRequest['intent'][] = ['stage', 'exhaust', 'tcu-shift', 'compare', 'map-edit', 'explain', 'unknown'];

/** Accept only well-formed fields from model output; anything else is dropped. */
export function sanitizeParsed(x: any, fallbackKind: ControllerKind): ParsedRequest {
  const out: ParsedRequest = {
    intent: INTENTS.includes(x?.intent) ? x.intent : 'unknown',
    kind: x?.kind === 'tcu' || x?.kind === 'ecu' ? x.kind : fallbackKind,
    blockedReasons: [],
    missing: [],
  };
  if ([1, 2, 3].includes(x?.stage)) out.stage = x.stage;
  if (typeof x?.keepProtections === 'boolean') out.keepProtections = x.keepProtections;
  if (typeof x?.respectTorqueLimits === 'boolean') out.respectTorqueLimits = x.respectTorqueLimits;
  if (x?.exhaust && typeof x.exhaust === 'object') {
    const e = x.exhaust;
    const modes = (v: unknown) => (Array.isArray(v) ? v.filter((m) => ['sport', 'normal', 'eco', 'comfort'].includes(m)) : undefined);
    out.exhaust = {
      intensity: ['mild', 'medium', 'strong'].includes(e.intensity) ? e.intensity : undefined,
      onlyModes: modes(e.onlyModes),
      disableModes: modes(e.disableModes),
      disableWithAc: e.disableWithAc === true || undefined,
      requireWarmEngine: e.requireWarmEngine === true || undefined,
      rpmMin: Number.isFinite(e.rpmMin) ? e.rpmMin : undefined,
      rpmMax: Number.isFinite(e.rpmMax) ? e.rpmMax : undefined,
    };
    if (!out.exhaust.intensity) out.missing.push('missing.intensity');
  }
  if (Array.isArray(x?.edits)) {
    out.edits = x.edits
      .filter((e: any) => typeof e?.mapQuery === 'string' && ['scale', 'offset', 'set'].includes(e?.op) && Number.isFinite(e?.value))
      .slice(0, 20)
      .map((e: any) => ({ mapQuery: e.mapQuery.slice(0, 80), op: e.op, value: e.value }));
  }
  return out;
}

const SYSTEM_PROMPT = `You convert a Hebrew vehicle-calibration request into JSON. Output ONLY a JSON object:
{"intent":"stage|exhaust|tcu-shift|compare|map-edit|explain|unknown","kind":"ecu|tcu","stage":1|2|3,
"keepProtections":bool,"respectTorqueLimits":bool,
"exhaust":{"intensity":"mild|medium|strong","onlyModes":["sport|normal|eco|comfort"],"disableModes":[...],"disableWithAc":bool,"requireWarmEngine":bool,"rpmMin":n,"rpmMax":n},
"edits":[{"mapQuery":"map name as written by the user","op":"scale|offset|set","value":n}]}
Rules: include only what the user explicitly said. Never invent numbers. "edits" only when the user wrote a number.
Omit fields that were not stated.`;

export class Assistant {
  constructor(
    private readonly calibration: Calibration,
    private readonly audit: AuditLog,
    private readonly secret: SecretStore,
    private settings: AiSettings = { model: DEFAULT_MODEL },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): AssistantStatus {
    const configured = !!this.secret.get();
    return { aiConfigured: configured, model: configured ? this.settings.model : undefined, engine: configured ? 'ai' : 'local' };
  }

  configure(apiKey: string | null, model?: string) {
    if (apiKey !== null && (typeof apiKey !== 'string' || apiKey.length < 20 || apiKey.length > 300)) {
      throw new WorkshopError('INVALID_INPUT', 'api key');
    }
    this.secret.set(apiKey);
    if (model && /^[a-z0-9.-]{3,60}$/.test(model)) this.settings = { model };
    this.audit.record('assistant.configure', 'ok', 'assistant', undefined, { ai: !!apiKey });
  }

  private async aiParse(text: string, kind: ControllerKind, signal?: AbortSignal): Promise<ParsedRequest> {
    const key = this.secret.get();
    if (!key) throw new WorkshopError('AI_UNAVAILABLE', 'not configured');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    signal?.addEventListener('abort', () => ctrl.abort());
    try {
      const res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.settings.model,
          max_tokens: 600,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `controller context: ${kind}\n\n${text}` }],
        }),
      });
      if (!res.ok) throw new WorkshopError('AI_UNAVAILABLE', `HTTP ${res.status}`);
      const body: any = await res.json();
      const textOut = String(body?.content?.find((c: any) => c.type === 'text')?.text ?? '');
      const json = textOut.slice(textOut.indexOf('{'), textOut.lastIndexOf('}') + 1);
      return sanitizeParsed(JSON.parse(json), kind);
    } catch (e) {
      if (e instanceof WorkshopError) throw e;
      throw new WorkshopError('AI_UNAVAILABLE', String((e as Error)?.message ?? e).slice(0, 120));
    } finally {
      clearTimeout(timer);
    }
  }

  async send(input: { text: string; kind: ControllerKind; projectId?: string; signal?: AbortSignal }): Promise<AssistantReply> {
    const text = String(input.text ?? '').trim();
    if (!text) throw new WorkshopError('INVALID_INPUT', 'empty');
    const local = parseRequest(text, input.kind);
    let parsed = local;
    let engine: 'local' | 'ai' = 'local';
    let aiError: string | undefined;
    if (this.status().aiConfigured) {
      try {
        parsed = sanitizeParsed(await this.aiParse(text, input.kind, input.signal), input.kind);
        engine = 'ai';
      } catch (e) {
        aiError = (e as WorkshopError).detail ?? 'error';
      }
    }
    // Safety rules are always the local ones — a model cannot remove a block.
    parsed = { ...parsed, blockedReasons: Array.from(new Set([...local.blockedReasons, ...parsed.blockedReasons])) };
    if (parsed.intent === 'unknown' && local.intent !== 'unknown') parsed = { ...local, blockedReasons: parsed.blockedReasons };

    const lines: AssistantReply['lines'] = [];
    lines.push({ key: engine === 'ai' ? 'asst.engineLine.ai' : 'asst.engineLine.local' });
    if (aiError) lines.push({ key: 'asst.aiFailed' });

    const request = this.calibration.createRequest({ projectId: input.projectId, kind: parsed.kind, text, parsed, engine });
    const plan = request.plan!;

    lines.push({ key: `asst.understood.${parsed.intent}`, params: { stage: parsed.stage ?? '' } });
    if (!input.projectId) lines.push({ key: 'asst.noProject' });
    if (plan.blocked.length) {
      lines.push({ key: 'asst.blocked' });
      for (const b of plan.blocked) lines.push({ key: `blockedReason.${b}` });
      return { request, lines, aiError };
    }
    for (const m of parsed.missing) lines.push({ key: `asst.${m}` });

    if (parsed.intent === 'compare' && input.projectId) {
      const last = this.calibration.latestVersion(input.projectId);
      const d = this.calibration.diff(input.projectId, 'original', last.id);
      lines.push({ key: 'asst.compare.summary', params: { bytes: d.changedBytes, maps: d.mapChanges.length, version: last.label } });
      for (const mc of d.mapChanges.slice(0, 12)) {
        const first = mc.cells[0];
        lines.push({ key: 'asst.compare.map', params: { name: mc.name, cells: mc.cells.length, from: first.from, to: first.to, unit: mc.unit } });
      }
      if (d.unexplained.length) lines.push({ key: 'asst.compare.unexplained', params: { n: d.unexplained.length } });
      if (d.changedBytes === 0) lines.push({ key: 'asst.compare.none' });
    }

    const ready = plan.items.filter((i) => i.status === 'ready' && i.operation).length;
    const needs = plan.items.filter((i) => i.status === 'needs-input').length;
    const unsupported = plan.items.filter((i) => i.status === 'unsupported').length;
    if (plan.items.length) lines.push({ key: 'asst.plan.summary', params: { ready, needs, unsupported } });
    const unsupportedConds = plan.conditions.filter((c) => !c.supported).length;
    if (plan.conditions.length) lines.push({ key: 'asst.plan.conditions', params: { ok: plan.conditions.length - unsupportedConds, no: unsupportedConds } });
    if (ready) lines.push({ key: 'asst.next.approve' });
    else if (needs) lines.push({ key: 'asst.next.needsInput' });
    lines.push({ key: 'asst.never.write' });

    this.audit.record('assistant.message', 'info', 'request', request.id, { engine, intent: parsed.intent });
    return { request, lines, aiError };
  }
}
