import { useEffect, useMemo, useState } from 'react';
import type { AssistantReply, CatalogOption, ControllerKind, IntegrityReport } from '../../shared/workshop';
import type { Go } from '../App';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { run, useResult } from '../state/useApi';
import { useToast } from '../ui/toast';
import { EmptyState, Ltr, ProvenanceBadge } from '../ui/primitives';
import { CheckList, DesktopOnly, KindTag, PlanView, Sha, StatusChip, fileProv, fmtBytes, fmtDate } from '../ui/workshop';

export function ControllerScreen({ kind, go, initialId }: { kind: ControllerKind; go: Go; initialId?: string }) {
  const s = useSession();
  const toast = useToast();
  const api = s.api;
  const controllers = useResult(api ? () => api.listControllers(kind) : null, [kind]);
  const [selected, setSelected] = useState<string | undefined>(initialId);
  useEffect(() => {
    if (!selected && controllers.data?.length) {
      const demoId = s.demoWorkspace?.[kind].controllerId;
      setSelected(controllers.data.find((c) => c.id === demoId)?.id ?? controllers.data[0].id);
    }
  }, [controllers.data, selected, s.demoWorkspace, kind]);

  if (!api) return <div className="screen"><DesktopOnly /></div>;

  const ctl = controllers.data?.find((c) => c.id === selected);
  return (
    <div className="screen">
      <header className="screen__head ctl__head">
        <div>
          <h1>{t(kind === 'ecu' ? 'ctl.ecuTitle' : 'ctl.tcuTitle')}</h1>
          <p className="lead">{t(kind === 'ecu' ? 'ctl.ecuLead' : 'ctl.tcuLead')}</p>
        </div>
        {!!controllers.data?.length && (
          <label className="field field--inline">
            <span className="field__label">{t('ctl.select')}</span>
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {controllers.data.map((c) => (
                <option key={c.id} value={c.id}>{[c.label, c.hwId].filter(Boolean).join(' · ') || c.id}</option>
              ))}
            </select>
          </label>
        )}
      </header>

      {controllers.data && controllers.data.length === 0 && (
        <EmptyState title={t('ctl.none')} lead={t('ctl.noneLead')}>
          <button className="btn btn--primary" onClick={() => go('vehicles')}>{t('nav2.vehicles')}</button>
        </EmptyState>
      )}
      {ctl && <ControllerDetail key={ctl.id} controllerId={ctl.id} kind={kind} go={go} toast={toast} />}
    </div>
  );
}

function ControllerDetail({ controllerId, kind, go, toast }: { controllerId: string; kind: ControllerKind; go: Go; toast: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  const s = useSession();
  const api = s.api!;
  const onErr = (e: { code: string }) => toast(t(`errors.${e.code}.title`) || e.code, 'error');
  const controllers = useResult(() => api.listControllers(kind), [controllerId]);
  const originals = useResult(() => api.listOriginals(), [controllerId]);
  const definition = useResult(() => api.getDefinition(controllerId), [controllerId]);
  const catalog = useResult(() => api.catalog(controllerId), [controllerId]);
  const compat = useResult(() => api.compatibility(controllerId), [controllerId]);
  const projects = useResult(() => api.listProjects(kind), [controllerId]);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [projectName, setProjectName] = useState('');

  const ctl = controllers.data?.find((c) => c.id === controllerId);
  const original = originals.data?.find((o) => o.controllerId === controllerId);
  const myProjects = projects.data?.filter((p) => p.controllerId === controllerId) ?? [];
  const def = definition.data;

  const reloadAll = () => {
    void originals.reload();
    void definition.reload();
    void catalog.reload();
    void compat.reload();
    void projects.reload();
  };

  const groups = useMemo(() => {
    const m = new Map<string, CatalogOption[]>();
    for (const o of catalog.data?.options ?? []) m.set(o.group, [...(m.get(o.group) ?? []), o]);
    return [...m.entries()];
  }, [catalog.data]);

  return (
    <div className="ctl">
      <div className="grid2">
        <section className="panel">
          <h2 className="panel__title">{t('ctl.identity')} <KindTag kind={kind} /></h2>
          {ctl && (
            <dl className="kv">
              <dt>{t('veh.label')}</dt><dd>{ctl.label ?? '—'}</dd>
              <dt>{t('veh.hwId')}</dt><dd>{ctl.hwId ? <Ltr>{ctl.hwId}</Ltr> : '—'}</dd>
              <dt>{t('veh.swId')}</dt><dd>{ctl.swId ? <Ltr>{ctl.swId}</Ltr> : '—'}</dd>
              <dt>{t('veh.calId')}</dt><dd>{ctl.calId ? <Ltr>{ctl.calId}</Ltr> : '—'}</dd>
              <dt>{t('provenance.legend')}</dt><dd><ProvenanceBadge p={ctl.idProvenance} /></dd>
            </dl>
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title">{t('ctl.original')}</h2>
          {!original ? (
            <>
              <p className="notice">{t('ctl.noOriginal')}</p>
              <div className="actions">
                <button className="btn btn--primary" onClick={async () => { if (await run(api.importOriginal(controllerId), onErr)) reloadAll(); }}>{t('ctl.importOriginal')}</button>
                <button className="btn" disabled title={t('ctl.readUnavailable')}>{t('ctl.readOriginal')}</button>
              </div>
              <p className="muted small">{t('ctl.readUnavailable')}</p>
            </>
          ) : (
            <>
              <dl className="kv">
                <dt>{t('backups.file')}</dt><dd><Ltr>{original.fileName}</Ltr></dd>
                <dt>{t('review.sha')}</dt><dd><Sha value={original.sha256} /></dd>
                <dt>{t('backups.size')}</dt><dd>{fmtBytes(original.size)}</dd>
                <dt>{t('backups.source')}</dt><dd><ProvenanceBadge p={fileProv(original.source)} /></dd>
                <dt>{t('backups.stored')}</dt><dd>{fmtDate(original.createdAt)}</dd>
                <dt>{t('backups.verified')}</dt><dd>{fmtDate(integrity?.checkedAt ?? original.verifiedAt)}</dd>
              </dl>
              {integrity && <p className={integrity.ok ? 'okline' : 'notice notice--bad'}>{integrity.ok ? t('ctl.verifiedOk') : t('ctl.verifiedBad')}</p>}
              <div className="actions">
                <button className="btn" onClick={async () => setIntegrity(await run(api.verifyOriginal(original.id), onErr))}>{t('ctl.verify')}</button>
                <button className="btn btn--quiet" onClick={() => run(api.exportOriginal(original.id), onErr)}>{t('ctl.export')}</button>
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title">{t('ctl.definition')}</h2>
          {!def ? (
            <p className="notice">{t('ctl.noDefinition')}</p>
          ) : (
            <>
              <p><strong>{def.name}</strong> · <span className="muted">{t('ctl.maps', { n: def.file.maps.length })}</span></p>
              <p className="small"><ProvenanceBadge p={def.source === 'simulated' ? 'simulated' : 'imported'} /> {t(def.source === 'simulated' ? 'ctl.definitionSimulated' : 'ctl.definitionUnverified')}</p>
              {compat.data && (
                <>
                  <h3 className="panel__sub">{t('ctl.compat')}</h3>
                  <CheckList checks={compat.data.checks} />
                </>
              )}
            </>
          )}
          <p className="muted small">{t('ctl.noGuessing')}</p>
          <div className="actions">
            <button className="btn" onClick={async () => { if (await run(api.importDefinition(controllerId), onErr)) reloadAll(); }}>{t('ctl.importDefinition')}</button>
          </div>
        </section>

        <section className="panel">
          <h2 className="panel__title">{t('ctl.projects')}</h2>
          {myProjects.map((p) => (
            <div key={p.id} className="plist__item">
              <span className="plist__main"><span className="plist__name">{p.name}</span><span className="muted small">{fmtDate(p.createdAt)}</span></span>
              <button className="btn btn--sm btn--primary" onClick={() => go('calibration', { projectId: p.id })}>{t('ctl.open')}</button>
            </div>
          ))}
          <div className="field-row">
            <label className="field">
              <span className="field__label">{t('ctl.projectName')}</span>
              <input value={projectName} onChange={(e) => setProjectName(e.target.value)} disabled={!original} />
            </label>
            <button
              className="btn field-row__btn"
              disabled={!original || !projectName.trim()}
              onClick={async () => {
                const r = await run(api.createProject(controllerId, projectName), onErr);
                if (r) {
                  setProjectName('');
                  void projects.reload();
                }
              }}
            >
              {t('ctl.newProject')}
            </button>
          </div>
          {!original && <p className="muted small">{t('ctl.noOriginal')}</p>}
        </section>
      </div>

      <section className="panel">
        <h2 className="panel__title">{t('ctl.catalog')}</h2>
        <div className="catalog">
          {groups.map(([g, opts]) => (
            <div key={g} className={`catalog__g${g === 'blocked' ? ' is-blocked' : ''}`}>
              <div className="catalog__gt">{t(`catalog.group.${g}`)}</div>
              {opts.map((o) => (
                <div key={o.id} className={`opt opt--${o.availability}`}>
                  <span className="opt__name">{t(`catalog.opt.${o.id}`)}</span>
                  <span className="opt__av">{t(`catalog.avail.${o.availability}`)}</span>
                  {o.availability === 'partial' && <span className="muted small">{t('catalog.missing', { tags: o.missingTags.map((x) => t(`plan.tag.${x.replace(/\./g, '_')}`) || x).join(', ') })}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="note">{t('catalog.blockedNote')}</p>
      </section>

      {kind === 'ecu' && <ExhaustPanel projectId={myProjects[0]?.id} />}
    </div>
  );
}

function ExhaustPanel({ projectId }: { projectId?: string }) {
  const s = useSession();
  const toast = useToast();
  const [text, setText] = useState('');
  const [reply, setReply] = useState<AssistantReply | null>(null);
  return (
    <section className="panel">
      <h2 className="panel__title">{t('exhaust.title')}</h2>
      <p className="small muted">{t('exhaust.lead')}</p>
      <textarea className="textarea" rows={3} value={text} placeholder={t('exhaust.placeholder')} onChange={(e) => setText(e.target.value)} />
      <div className="actions">
        <button
          className="btn btn--primary"
          disabled={!text.trim()}
          onClick={async () => setReply(await run(s.api!.assistantAsk({ text: `Pops & Bangs: ${text}`, kind: 'ecu', projectId }), (e) => toast(t(`errors.${e.code}.title`), 'error')))}
        >
          {t('exhaust.analyze')}
        </button>
      </div>
      {reply && (
        <div className="reply">
          <StatusChip status={reply.request.status} />
          <ul className="reply__lines">{reply.lines.map((l, i) => <li key={i}>{t(l.key, l.params)}</li>)}</ul>
          {reply.request.plan && <PlanView plan={reply.request.plan} />}
        </div>
      )}
    </section>
  );
}
