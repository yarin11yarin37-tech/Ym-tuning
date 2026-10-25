/**
 * Ordered, append-only schema migrations. Never edit a released migration — add a new one.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core',
    sql: `
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE vehicles (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  vin TEXT,
  vin_provenance TEXT CHECK (vin_provenance IN ('vehicle','user','imported','simulated')),
  make TEXT, model TEXT, year INTEGER, engine TEXT, gearbox TEXT, plate TEXT, notes TEXT,
  created_at TEXT NOT NULL
);

-- ECU and TCU are always separate rows; nothing is shared between them.
CREATE TABLE controllers (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('ecu','tcu')),
  label TEXT,
  hw_id TEXT, sw_id TEXT, cal_id TEXT,
  id_provenance TEXT NOT NULL CHECK (id_provenance IN ('vehicle','user','imported','simulated')),
  created_at TEXT NOT NULL
);

CREATE TABLE blobs (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64),
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Original files. Immutable: see triggers below.
CREATE TABLE originals (
  id TEXT PRIMARY KEY,
  controller_id TEXT NOT NULL REFERENCES controllers(id),
  kind TEXT NOT NULL CHECK (kind IN ('ecu','tcu')),
  sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  size INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('read','imported','simulated')),
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  verified_at TEXT
);
CREATE UNIQUE INDEX originals_one_per_controller ON originals(controller_id);

CREATE TRIGGER originals_immutable BEFORE UPDATE ON originals
WHEN NEW.sha256 IS NOT OLD.sha256 OR NEW.size IS NOT OLD.size OR NEW.source IS NOT OLD.source
  OR NEW.controller_id IS NOT OLD.controller_id OR NEW.kind IS NOT OLD.kind OR NEW.file_name IS NOT OLD.file_name
  OR NEW.created_at IS NOT OLD.created_at OR NEW.meta_json IS NOT OLD.meta_json
BEGIN SELECT RAISE(ABORT, 'ORIGINAL_IMMUTABLE'); END;

CREATE TRIGGER originals_no_delete BEFORE DELETE ON originals
BEGIN SELECT RAISE(ABORT, 'ORIGINAL_IMMUTABLE'); END;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  controller_id TEXT NOT NULL REFERENCES controllers(id),
  kind TEXT NOT NULL CHECK (kind IN ('ecu','tcu')),
  name TEXT NOT NULL,
  original_id TEXT NOT NULL REFERENCES originals(id),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT REFERENCES versions(id),
  seq INTEGER NOT NULL,
  sha256 TEXT NOT NULL REFERENCES blobs(sha256),
  label TEXT NOT NULL,
  note TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('working-copy','manual-edit','plan-applied')),
  checks_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (project_id, seq)
);
CREATE TRIGGER versions_immutable BEFORE UPDATE OF sha256, parent_id, project_id, seq ON versions
BEGIN SELECT RAISE(ABORT, 'VERSION_IMMUTABLE'); END;

-- Map definitions are imported files. They are never marked verified by the app itself.
CREATE TABLE definitions (
  id TEXT PRIMARY KEY,
  controller_id TEXT NOT NULL REFERENCES controllers(id),
  kind TEXT NOT NULL CHECK (kind IN ('ecu','tcu')),
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('imported','simulated')),
  created_at TEXT NOT NULL
);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  kind TEXT NOT NULL CHECK (kind IN ('ecu','tcu')),
  text TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  plan_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('request','plan','approved','applied','verified','written','rejected')),
  result_version_id TEXT REFERENCES versions(id),
  engine TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE diag_sessions (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  mode TEXT NOT NULL CHECK (mode IN ('live','demo')),
  title TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Append-only action log.
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok','blocked','error','info')),
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY'); END;

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
];
