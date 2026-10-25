import { useState } from 'react';
import type { DeviceCapabilities, UsbScan } from '../../shared/workshop';
import { t } from '../i18n';
import { useSession } from '../state/session';
import { useResult } from '../state/useApi';
import { Ltr } from '../ui/primitives';
import { DesktopOnly } from '../ui/workshop';

/** Same values as electron/hardware/hal.ts — the renderer only displays them. */
const ELM327_WIFI: DeviceCapabilities = {
  basicObd: 'untested', oemDiagnostics: 'not-supported', ecuRead: 'not-supported', ecuWrite: 'not-supported',
  tcuRead: 'not-supported', tcuWrite: 'not-supported', can: 'unknown', canFd: 'not-supported', isoTp: 'unknown',
  kLine: 'unknown', doip: 'not-supported',
};

export function CapabilityTable({ caps }: { caps: DeviceCapabilities }) {
  return (
    <table className="table table--tight">
      <tbody>
        {(Object.keys(caps) as (keyof DeviceCapabilities)[]).map((k) => (
          <tr key={k}>
            <th scope="row">{t(`vci2.cap.${k}`)}</th>
            <td><span className={`capst capst--${caps[k]}`}>{t(`vci2.state.${caps[k]}`)}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function VciScreen() {
  const s = useSession();
  const roadmap = useResult(s.api ? () => s.api!.protocolRoadmap() : null, []);
  const [usb, setUsb] = useState<UsbScan | null>(null);
  if (!s.api) return <div className="screen"><DesktopOnly /></div>;
  const connected = s.status.phase === 'connected';

  return (
    <div className="screen">
      <header className="screen__head">
        <h1>{t('vci2.title')}</h1>
        <p className="lead">{t('vci2.lead')}</p>
      </header>
      <div className="grid2">
        <section className="panel">
          <h2 className="panel__title">{t('vci2.current')}</h2>
          {connected ? (
            <>
              <p><Ltr>{s.status.adapterId ?? ''}</Ltr> · <Ltr>{`${s.status.host}:${s.status.port}`}</Ltr></p>
              <CapabilityTable caps={ELM327_WIFI} />
            </>
          ) : (
            <p className="muted">{t('vci2.noDevice')}</p>
          )}
        </section>
        <section className="panel">
          <h2 className="panel__title">{t('vci2.hardware')}</h2>
          <p><span className="tag">{t('vci2.hardwareStatus')}</span></p>
          <p className="small muted">{t('usb.vciNotFound')}</p>
          <div className="panel__bar">
            <h3 className="panel__sub">{t('usb.title')}</h3>
            <button className="btn btn--sm" onClick={async () => { const r = await s.api!.usbScan().catch(() => null); if (r?.ok) setUsb(r.data); }}>
              {t('usb.scan')}
            </button>
          </div>
          {usb && usb.devices.length === 0 && <p className="muted small">{usb.supported ? t('usb.none') : t(usb.reasonKey ?? 'usb.reason.platform')}</p>}
          {usb?.devices.map((d) => (
            <div key={d.id} className="devrow">
              <Ltr>{d.path ?? d.name}</Ltr>
              <p className="small muted">{t('usb.notIdentified')}</p>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2 className="panel__title">{t('vci2.roadmap')}</h2>
          <table className="table table--tight">
            <tbody>
              {(roadmap.data ?? []).map((p) => (
                <tr key={p.id}>
                  <th scope="row">{t(`vci2.proto.${p.id}`)}</th>
                  <td><span className={`capst capst--${p.status === 'planned' ? 'not-supported' : 'untested'}`}>{t(`vci2.pstate.${p.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
