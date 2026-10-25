import { useState } from 'react';
import type { ControllerKind, Customer, Vehicle } from '../../shared/workshop';
import type { Go } from '../App';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { run, useResult } from '../state/useApi';
import { useToast } from '../ui/toast';
import { EmptyState, Ltr, ProvenanceBadge } from '../ui/primitives';
import { DesktopOnly, Field, KindTag } from '../ui/workshop';

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function VehiclesScreen({ go }: { go: Go }) {
  const s = useSession();
  const toast = useToast();
  const api = s.api;
  const customers = useResult(api ? () => api.listCustomers() : null, []);
  const vehicles = useResult(api ? () => api.listVehicles() : null, []);
  const controllers = useResult(api ? () => api.listControllers() : null, []);
  const [cust, setCust] = useState<Partial<Customer>>({});
  const [veh, setVeh] = useState<Partial<Vehicle>>({});
  const [ctlForm, setCtlForm] = useState<{ vehicleId: string; kind: ControllerKind; label: string; hwId: string; swId: string; calId: string } | null>(null);
  const onErr = (e: { code: string }) => toast(t(`errors.${e.code}.title`) || e.code, 'error');

  if (!api) return <div className="screen"><DesktopOnly /></div>;

  const saveCustomer = async () => {
    if (!cust.name?.trim()) return;
    if (await run(api.saveCustomer(cust as any), onErr)) {
      toast(t('veh.saved'), 'success');
      setCust({});
      void customers.reload();
    }
  };
  const saveVehicle = async () => {
    if (veh.vin && !VIN_RE.test(veh.vin.toUpperCase())) return toast(t('veh.invalidVin'), 'error');
    if (await run(api.saveVehicle({ ...veh, vin: veh.vin?.toUpperCase() || undefined, vinProvenance: 'user' }), onErr)) {
      toast(t('veh.saved'), 'success');
      setVeh({});
      void vehicles.reload();
    }
  };
  const saveFromConnected = async () => {
    const id = s.identity;
    if (!id) return;
    const r = await run(api.saveVehicle({ vin: id.vin?.value, vinProvenance: id.vin?.provenance === 'simulated' ? 'simulated' : 'vehicle', notes: id.protocol?.value }), onErr);
    if (r) {
      toast(t('veh.saved'), 'success');
      void vehicles.reload();
    }
  };
  const saveController = async () => {
    if (!ctlForm) return;
    if (await run(api.addController(ctlForm), onErr)) {
      toast(t('veh.saved'), 'success');
      setCtlForm(null);
      void controllers.reload();
    }
  };

  const custName = (id?: string) => customers.data?.find((c) => c.id === id)?.name ?? t('veh.noCustomer');

  return (
    <div className="screen">
      <header className="screen__head">
        <h1>{t('veh.title')}</h1>
      </header>

      <div className="grid2">
        <section className="panel">
          <h2 className="panel__title">{t('veh.newVehicle')}</h2>
          <div className="formgrid">
            <Field label={t('veh.customer')}>
              <select value={veh.customerId ?? ''} onChange={(e) => setVeh({ ...veh, customerId: e.target.value || undefined })}>
                <option value="">{t('veh.noCustomer')}</option>
                {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label={t('veh.vin')}>
              <input dir="ltr" className="mono" maxLength={17} value={veh.vin ?? ''} onChange={(e) => setVeh({ ...veh, vin: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('veh.make')}><input value={veh.make ?? ''} onChange={(e) => setVeh({ ...veh, make: e.target.value })} /></Field>
            <Field label={t('veh.model')}><input value={veh.model ?? ''} onChange={(e) => setVeh({ ...veh, model: e.target.value })} /></Field>
            <Field label={t('veh.year')}><input dir="ltr" inputMode="numeric" value={veh.year ?? ''} onChange={(e) => setVeh({ ...veh, year: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            <Field label={t('veh.plate')}><input dir="ltr" className="mono" value={veh.plate ?? ''} onChange={(e) => setVeh({ ...veh, plate: e.target.value })} /></Field>
            <Field label={t('veh.engine')}><input value={veh.engine ?? ''} onChange={(e) => setVeh({ ...veh, engine: e.target.value })} /></Field>
            <Field label={t('veh.gearbox')}><input value={veh.gearbox ?? ''} onChange={(e) => setVeh({ ...veh, gearbox: e.target.value })} /></Field>
          </div>
          <p className="muted small">{t('veh.idEnteredNote')}</p>
          <div className="actions">
            <button className="btn btn--primary" onClick={saveVehicle}>{t('veh.save')}</button>
            {s.identity && (s.mode === 'live' || s.mode === 'demo') && (
              <button className="btn" onClick={saveFromConnected} title={t('veh.fromConnectedNote')}>{t('veh.fromConnected')}</button>
            )}
          </div>
        </section>

        <section className="panel">
          <h2 className="panel__title">{t('veh.newCustomer')}</h2>
          <div className="formgrid">
            <Field label={t('veh.name')}><input value={cust.name ?? ''} onChange={(e) => setCust({ ...cust, name: e.target.value })} /></Field>
            <Field label={t('veh.phone')}><input dir="ltr" inputMode="tel" value={cust.phone ?? ''} onChange={(e) => setCust({ ...cust, phone: e.target.value })} /></Field>
            <Field label={t('veh.email')}><input dir="ltr" type="email" value={cust.email ?? ''} onChange={(e) => setCust({ ...cust, email: e.target.value })} /></Field>
            <Field label={t('veh.notes')}><input value={cust.notes ?? ''} onChange={(e) => setCust({ ...cust, notes: e.target.value })} /></Field>
          </div>
          <div className="actions"><button className="btn" onClick={saveCustomer} disabled={!cust.name?.trim()}>{t('veh.save')}</button></div>
          <h3 className="panel__sub">{t('veh.customers')}</h3>
          {customers.data?.length ? (
            <ul className="plist">{customers.data.map((c) => <li key={c.id} className="plist__item"><span className="plist__name">{c.name}</span>{c.phone && <Ltr>{c.phone}</Ltr>}</li>)}</ul>
          ) : <p className="muted small">{t('veh.emptyCustomers')}</p>}
        </section>
      </div>

      <section className="panel">
        <h2 className="panel__title">{t('veh.vehicles')}</h2>
        {!vehicles.data?.length ? (
          <EmptyState title={t('veh.empty')} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('veh.vin')}</th>
                <th scope="col">{t('veh.make')}</th>
                <th scope="col">{t('veh.customer')}</th>
                <th scope="col">{t('veh.controllers')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {vehicles.data.map((v) => {
                const ctls = controllers.data?.filter((c) => c.vehicleId === v.id) ?? [];
                return (
                  <tr key={v.id}>
                    <td>{v.vin ? <span className="sourced"><Ltr>{v.vin}</Ltr>{v.vinProvenance && <ProvenanceBadge p={v.vinProvenance} compact />}</span> : '—'}</td>
                    <td>{[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'}</td>
                    <td>{custName(v.customerId)}</td>
                    <td>
                      <span className="chips">
                        {ctls.map((c) => (
                          <button key={c.id} className="chiplink" onClick={() => go(c.kind, { controllerId: c.id })}>
                            <KindTag kind={c.kind} /> {c.label ?? c.hwId ?? ''}
                          </button>
                        ))}
                      </span>
                    </td>
                    <td className="table__actions">
                      <button className="btn btn--sm" onClick={() => setCtlForm({ vehicleId: v.id, kind: 'ecu', label: '', hwId: '', swId: '', calId: '' })}>{t('veh.addEcu')}</button>
                      <button className="btn btn--sm" onClick={() => setCtlForm({ vehicleId: v.id, kind: 'tcu', label: '', hwId: '', swId: '', calId: '' })}>{t('veh.addTcu')}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {ctlForm && (
          <div className="subform">
            <h3 className="panel__sub">{ctlForm.kind === 'ecu' ? t('veh.addEcu') : t('veh.addTcu')}</h3>
            <div className="formgrid">
              <Field label={t('veh.label')}><input value={ctlForm.label} onChange={(e) => setCtlForm({ ...ctlForm, label: e.target.value })} /></Field>
              <Field label={t('veh.hwId')}><input dir="ltr" className="mono" value={ctlForm.hwId} onChange={(e) => setCtlForm({ ...ctlForm, hwId: e.target.value })} /></Field>
              <Field label={t('veh.swId')}><input dir="ltr" className="mono" value={ctlForm.swId} onChange={(e) => setCtlForm({ ...ctlForm, swId: e.target.value })} /></Field>
              <Field label={t('veh.calId')}><input dir="ltr" className="mono" value={ctlForm.calId} onChange={(e) => setCtlForm({ ...ctlForm, calId: e.target.value })} /></Field>
            </div>
            <p className="muted small">{t('veh.idEnteredNote')}</p>
            <div className="actions">
              <button className="btn btn--primary" onClick={saveController}>{t('veh.save')}</button>
              <button className="btn btn--quiet" onClick={() => setCtlForm(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
