import { useEffect, useRef, useState } from 'react';
import type { AssistantReply, CalibrationRequest, ControllerKind } from '../../shared/workshop';
import type { Go } from '../App';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { run, useResult } from '../state/useApi';
import { useToast } from '../ui/toast';
import { Lifecycle, DesktopOnly, PlanView, StatusChip } from '../ui/workshop';

const EXAMPLES = [
  'אני רוצה Stage 1 עם שמירה על הגנות היצרן.',
  'אני רוצה Pops & Bangs עדינים רק במצב Sport, בלי הפעלה כשהמזגן פועל.',
  'אני רוצה העברות גיר חלקות יותר בלי לעבור את מגבלות המומנט המאומתות.',
  'השווה בין הקובץ המקורי לקובץ העבודה והסבר כל שינוי שזוהה.',
  'הגדל את יעד הגדישה ב-5%',
];

interface Turn { id: string; text: string; reply?: AssistantReply; request?: CalibrationRequest }

export function AssistantScreen({ go, initialProjectId, initialText }: { go: Go; initialProjectId?: string; initialText?: string }) {
  const s = useSession();
  const toast = useToast();
  const api = s.api;
  const status = useResult(api ? () => api.assistantStatus() : null, []);
  const projects = useResult(api ? () => api.listProjects() : null, []);
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId);
  const [text, setText] = useState(initialText ?? '');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(s.demoWorkspace?.ecu.projectId ?? projects.data[0].id);
  }, [projects.data, projectId, s.demoWorkspace]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns]);

  if (!api) return <div className="screen"><DesktopOnly /></div>;
  const project = projects.data?.find((p) => p.id === projectId);
  const kind: ControllerKind = project?.kind ?? 'ecu';
  const onErr = (e: { code: string; detail?: string }) => toast(`${t(`errors.${e.code}.title`)}${e.detail ? ` — ${e.detail}` : ''}`, 'error');

  const send = async () => {
    const msg = text.trim();
    if (!msg || busy) return;
    const id = String(Date.now());
    setTurns((x) => [...x, { id, text: msg }]);
    setText('');
    setBusy(true);
    const reply = await run(api.assistantAsk({ text: msg, kind, projectId }), onErr);
    setBusy(false);
    setTurns((x) => x.map((tu) => (tu.id === id ? { ...tu, reply: reply ?? undefined, request: reply?.request } : tu)));
  };

  const update = (id: string, request: CalibrationRequest) => setTurns((x) => x.map((tu) => (tu.id === id ? { ...tu, request } : tu)));

  return (
    <div className="screen asst">
      <header className="screen__head ctl__head">
        <div>
          <h1>{t('asst.title')}</h1>
          <p className="lead">{t('asst.lead')}</p>
        </div>
        <label className="field field--inline">
          <span className="field__label">{t('asst.project')}</span>
          <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || undefined)}>
            <option value="">{t('asst.projectNone')}</option>
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{`${p.kind.toUpperCase()} · ${p.name}`}</option>)}
          </select>
        </label>
      </header>

      <div className={`engine engine--${status.data?.engine ?? 'local'}`} role="status">
        <span className="engine__dot" aria-hidden="true" />
        {status.data?.aiConfigured ? t('asst.engineAi', { model: status.data.model ?? '' }) : t('asst.engineLocal')}
        {!status.data?.aiConfigured && <button className="btn btn--sm btn--quiet" onClick={() => go('settings')}>{t('asst.configureAi')}</button>}
      </div>
      <p className="muted small">{t('asst.stagesLegend')}</p>

      <section className="chat panel">
        {turns.length === 0 && (
          <div className="chat__examples">
            <div className="panel__sub">{t('asst.examples')}</div>
            {EXAMPLES.map((e) => <button key={e} className="example" onClick={() => setText(e)}>{e}</button>)}
          </div>
        )}
        {turns.map((tu) => (
          <div key={tu.id} className="turn">
            <div className="bubble bubble--user"><span className="bubble__who">{t('asst.you')}</span>{tu.text}</div>
            {tu.reply && tu.request && (
              <div className="bubble bubble--asst">
                <div className="bubble__head">
                  <StatusChip status={tu.request.status} />
                  <span className="muted small">{t(`asst.engine.${tu.request.engine}`)}</span>
                </div>
                <ul className="reply__lines">{tu.reply.lines.map((l, i) => <li key={i}>{t(l.key, l.params)}</li>)}</ul>
                {tu.request.plan && (tu.request.plan.items.length > 0 || tu.request.plan.blocked.length > 0 || tu.request.plan.conditions.length > 0) && <PlanView plan={tu.request.plan} />}
                <Lifecycle status={tu.request.status} />
                <div className="actions">
                  {tu.request.status === 'plan' && tu.request.plan?.items.some((i) => i.status === 'ready' && i.operation) && (
                    <button className="btn btn--sm btn--primary" onClick={async () => { const r = await run(api.approveRequest(tu.request!.id), onErr); if (r) update(tu.id, r); }}>{t('calenv.approve')}</button>
                  )}
                  {tu.request.status === 'approved' && (
                    <button className="btn btn--sm btn--primary" onClick={async () => {
                      const r = await run(api.applyRequest(tu.request!.id), onErr);
                      if (r) { update(tu.id, r.request); toast(t('calenv.applied', { v: r.version.label }), 'success'); }
                    }}>{t('calenv.apply')}</button>
                  )}
                  {(tu.request.status === 'applied' || tu.request.status === 'verified') && tu.request.projectId && (
                    <button className="btn btn--sm" onClick={() => go('calibration', { projectId: tu.request!.projectId })}>{t('calenv.review')}</button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </section>

      <div className="composer">
        <textarea
          className="textarea"
          rows={2}
          value={text}
          placeholder={t('asst.placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
        />
        <button className="btn btn--primary" onClick={send} disabled={busy || !text.trim()}>{busy ? t('common.loading') : t('asst.send')}</button>
      </div>
    </div>
  );
}
