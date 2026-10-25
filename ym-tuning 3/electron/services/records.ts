import type { Db } from '../db/database';
import { newId } from '../db/database';
import type { AuditLog } from './audit';
import type { Controller, ControllerKind, Customer, DiagSession, IdProvenance, Vehicle } from '../../shared/workshop';
import { WorkshopError } from './errors';

const str = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new WorkshopError('INVALID_INPUT', 'expected text');
  return v.trim().slice(0, max) || null;
};
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const PROV: IdProvenance[] = ['vehicle', 'user', 'imported', 'simulated'];

/** Customers, vehicles, controllers and diagnostic sessions. */
export class Records {
  constructor(private readonly db: Db, private readonly audit: AuditLog) {}

  /* ----- customers ----- */
  saveCustomer(input: Partial<Customer> & { name: string }): Customer {
    const name = str(input.name, 120);
    if (!name) throw new WorkshopError('INVALID_INPUT', 'name required');
    const id = input.id && /^cus_/.test(input.id) ? input.id : newId('cus');
    const exists = this.db.get('SELECT id FROM customers WHERE id = ?', [id]);
    const vals = [name, str(input.phone, 40), str(input.email, 120), str(input.notes, 2000)];
    if (exists) this.db.run('UPDATE customers SET name=?, phone=?, email=?, notes=? WHERE id=?', [...vals, id]);
    else this.db.run('INSERT INTO customers (name, phone, email, notes, id, created_at) VALUES (?,?,?,?,?,?)', [...vals, id, new Date().toISOString()]);
    this.audit.record(exists ? 'customer.update' : 'customer.create', 'ok', 'customer', id);
    return this.listCustomers().find((c) => c.id === id)!;
  }

  listCustomers(): Customer[] {
    return this.db.all<any>('SELECT * FROM customers ORDER BY name').map((r) => ({
      id: r.id, name: r.name, phone: r.phone ?? undefined, email: r.email ?? undefined, notes: r.notes ?? undefined, createdAt: r.created_at,
    }));
  }

  /* ----- vehicles ----- */
  saveVehicle(input: Partial<Vehicle>): Vehicle {
    const vin = str(input.vin, 17)?.toUpperCase() ?? null;
    if (vin && !VIN_RE.test(vin)) throw new WorkshopError('INVALID_INPUT', 'invalid VIN');
    const vinProv = vin ? (PROV.includes(input.vinProvenance as IdProvenance) ? input.vinProvenance! : 'user') : null;
    const year = input.year === undefined || input.year === null ? null : Number(input.year);
    if (year !== null && (!Number.isInteger(year) || year < 1950 || year > 2100)) throw new WorkshopError('INVALID_INPUT', 'year');
    if (input.customerId && !this.db.get('SELECT id FROM customers WHERE id = ?', [input.customerId])) {
      throw new WorkshopError('NOT_FOUND', 'customer');
    }
    const id = input.id && /^veh_/.test(input.id) ? input.id : newId('veh');
    const exists = this.db.get('SELECT id FROM vehicles WHERE id = ?', [id]);
    const vals = [
      input.customerId ?? null, vin, vinProv, str(input.make, 60), str(input.model, 60), year,
      str(input.engine, 80), str(input.gearbox, 80), str(input.plate, 20), str(input.notes, 2000),
    ];
    if (exists) {
      this.db.run('UPDATE vehicles SET customer_id=?, vin=?, vin_provenance=?, make=?, model=?, year=?, engine=?, gearbox=?, plate=?, notes=? WHERE id=?', [...vals, id]);
    } else {
      this.db.run(
        'INSERT INTO vehicles (customer_id, vin, vin_provenance, make, model, year, engine, gearbox, plate, notes, id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [...vals, id, new Date().toISOString()],
      );
    }
    this.audit.record(exists ? 'vehicle.update' : 'vehicle.create', 'ok', 'vehicle', id, { vinProvenance: vinProv });
    return this.listVehicles().find((v) => v.id === id)!;
  }

  listVehicles(): Vehicle[] {
    return this.db.all<any>('SELECT * FROM vehicles ORDER BY created_at DESC').map((r) => ({
      id: r.id, customerId: r.customer_id ?? undefined, vin: r.vin ?? undefined, vinProvenance: r.vin_provenance ?? undefined,
      make: r.make ?? undefined, model: r.model ?? undefined, year: r.year ?? undefined, engine: r.engine ?? undefined,
      gearbox: r.gearbox ?? undefined, plate: r.plate ?? undefined, notes: r.notes ?? undefined, createdAt: r.created_at,
    }));
  }

  /* ----- controllers (ECU and TCU are always separate) ----- */
  addController(input: { vehicleId: string; kind: ControllerKind; label?: string; hwId?: string; swId?: string; calId?: string; idProvenance: IdProvenance }): Controller {
    if (input.kind !== 'ecu' && input.kind !== 'tcu') throw new WorkshopError('INVALID_INPUT', 'kind');
    if (!PROV.includes(input.idProvenance)) throw new WorkshopError('INVALID_INPUT', 'provenance');
    if (!this.db.get('SELECT id FROM vehicles WHERE id = ?', [input.vehicleId])) throw new WorkshopError('NOT_FOUND', 'vehicle');
    const id = newId(input.kind);
    this.db.run(
      'INSERT INTO controllers (id, vehicle_id, kind, label, hw_id, sw_id, cal_id, id_provenance, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, input.vehicleId, input.kind, str(input.label, 80), str(input.hwId, 60), str(input.swId, 60), str(input.calId, 60), input.idProvenance, new Date().toISOString()],
    );
    this.audit.record('controller.create', 'ok', 'controller', id, { kind: input.kind, provenance: input.idProvenance });
    return this.getController(id)!;
  }

  getController(id: string): Controller | undefined {
    const r = this.db.get<any>('SELECT * FROM controllers WHERE id = ?', [id]);
    return r ? mapController(r) : undefined;
  }

  listControllers(kind?: ControllerKind): Controller[] {
    const rows = kind
      ? this.db.all<any>('SELECT * FROM controllers WHERE kind = ? ORDER BY created_at DESC', [kind])
      : this.db.all<any>('SELECT * FROM controllers ORDER BY created_at DESC');
    return rows.map(mapController);
  }

  /* ----- diagnostic sessions ----- */
  saveSession(input: { vehicleId?: string; mode: 'live' | 'demo'; title: string; data: unknown }): DiagSession {
    if (input.mode !== 'live' && input.mode !== 'demo') throw new WorkshopError('INVALID_INPUT', 'mode');
    const json = JSON.stringify(input.data ?? {});
    if (json.length > 2_000_000) throw new WorkshopError('INVALID_INPUT', 'session too large');
    const id = newId('ses');
    this.db.run('INSERT INTO diag_sessions (id, vehicle_id, mode, title, data_json, created_at) VALUES (?,?,?,?,?,?)', [
      id, input.vehicleId ?? null, input.mode, str(input.title, 120) ?? 'session', json, new Date().toISOString(),
    ]);
    this.audit.record('diag.session.save', 'ok', 'session', id, { mode: input.mode });
    return this.listSessions().find((s) => s.id === id)!;
  }

  listSessions(): DiagSession[] {
    return this.db.all<any>('SELECT * FROM diag_sessions ORDER BY created_at DESC LIMIT 200').map((r) => ({
      id: r.id, vehicleId: r.vehicle_id ?? undefined, mode: r.mode, title: r.title, data: JSON.parse(r.data_json), createdAt: r.created_at,
    }));
  }
}

function mapController(r: any): Controller {
  return {
    id: r.id, vehicleId: r.vehicle_id, kind: r.kind, label: r.label ?? undefined, hwId: r.hw_id ?? undefined,
    swId: r.sw_id ?? undefined, calId: r.cal_id ?? undefined, idProvenance: r.id_provenance, createdAt: r.created_at,
  };
}
