/**
 * Builds the assistant's reply lines (i18n keys + params). Pure — shared by the desktop
 * assistant service and the in-browser demo, so both answer identically.
 */
import type { AssistantReply, CalibrationRequest, DiffReport, ParsedRequest } from '../../shared/workshop';

export function composeReply(x: {
  parsed: ParsedRequest;
  request: CalibrationRequest;
  engine: 'local' | 'ai';
  aiError?: string;
  hasProject: boolean;
  compare?: { diff: DiffReport; versionLabel: string };
}): AssistantReply['lines'] {
  const { parsed, request } = x;
  const plan = request.plan!;
  const lines: AssistantReply['lines'] = [];
  lines.push({ key: x.engine === 'ai' ? 'asst.engineLine.ai' : 'asst.engineLine.local' });
  if (x.aiError) lines.push({ key: 'asst.aiFailed' });
  lines.push({ key: `asst.understood.${parsed.intent}`, params: { stage: parsed.stage ?? '' } });
  if (!x.hasProject) lines.push({ key: 'asst.noProject' });
  if (plan.blocked.length) {
    lines.push({ key: 'asst.blocked' });
    for (const b of plan.blocked) lines.push({ key: `blockedReason.${b}` });
    return lines;
  }
  for (const m of parsed.missing) lines.push({ key: `asst.${m}` });

  if (x.compare) {
    const d = x.compare.diff;
    lines.push({ key: 'asst.compare.summary', params: { bytes: d.changedBytes, maps: d.mapChanges.length, version: x.compare.versionLabel } });
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
  const no = plan.conditions.filter((c) => !c.supported).length;
  if (plan.conditions.length) lines.push({ key: 'asst.plan.conditions', params: { ok: plan.conditions.length - no, no } });
  if (ready) lines.push({ key: 'asst.next.approve' });
  else if (needs) lines.push({ key: 'asst.next.needsInput' });
  lines.push({ key: 'asst.never.write' });
  return lines;
}

/** Safety rules are always the local ones — a model cannot remove a block. */
export function mergeParsed(local: ParsedRequest, other: ParsedRequest): ParsedRequest {
  let parsed = { ...other, blockedReasons: Array.from(new Set([...local.blockedReasons, ...other.blockedReasons])) };
  if (parsed.intent === 'unknown' && local.intent !== 'unknown') parsed = { ...local, blockedReasons: parsed.blockedReasons };
  return parsed;
}
