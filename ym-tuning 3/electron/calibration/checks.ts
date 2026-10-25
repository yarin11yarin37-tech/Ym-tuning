import type { CheckResult, Controller, DefinitionFile, IntegrityReport, OriginalFile, WriteGateResult } from '../../shared/workshop';
import { checkCompatibility, readMap } from './definitions';
import { diffFiles } from './diff';

/**
 * File-level verification of a working version against its original. "pass" here means the
 * file passed YM TUNING's offline checks — it does NOT mean the file is safe to write.
 */
export function verifyVersion(args: {
  original: OriginalFile;
  originalBytes: Uint8Array;
  integrity: IntegrityReport;
  versionBytes: Uint8Array;
  versionSha: string;
  controller: Controller;
  def?: DefinitionFile;
}): CheckResult[] {
  const { original, originalBytes, integrity, versionBytes, def, controller } = args;
  const checks: CheckResult[] = [];
  checks.push({ id: 'originalIntact', status: integrity.ok ? 'pass' : 'fail' });
  checks.push({ id: 'sizeMatch', status: versionBytes.length === original.size ? 'pass' : 'fail' });

  if (def) {
    const compat = checkCompatibility(def, controller, original.size);
    checks.push({ id: 'compatibility', status: compat.ok ? 'pass' : 'fail' });
    const diff = diffFiles(originalBytes, versionBytes, original.sha256, args.versionSha, def);
    checks.push({
      id: 'changesInsideMaps',
      status: diff.unexplained.length === 0 ? 'pass' : 'fail',
      detail: { unexplainedRanges: diff.unexplained.length, changedBytes: diff.changedBytes },
    });
    let out = 0;
    for (const m of def.maps) if (m.min !== undefined || m.max !== undefined) out += readMap(versionBytes, m).outOfRange;
    checks.push({ id: 'valuesInRange', status: out === 0 ? 'pass' : 'fail', detail: { outOfRange: out } });
    checks.push({ id: 'definitionVerified', status: 'unavailable' });
  } else {
    checks.push({ id: 'compatibility', status: 'unavailable' });
    checks.push({ id: 'changesInsideMaps', status: 'unavailable' });
  }
  // No controller has a verified checksum algorithm in YM TUNING yet.
  checks.push({ id: 'checksum', status: 'unavailable' });
  return checks;
}

/**
 * Write gate. Writing to a physical ECU/TCU stays disabled until a verified implementation
 * exists for the controller, hardware, protocol, file and restore procedure. The return type
 * makes `allowed: true` impossible in this version.
 */
export function evaluateWriteGate(args: {
  controller: Controller;
  integrity?: IntegrityReport;
  checks: CheckResult[];
  approved: boolean;
}): WriteGateResult {
  const noFail = args.checks.length > 0 && !args.checks.some((c) => c.status === 'fail');
  const compat = args.checks.find((c) => c.id === 'compatibility')?.status === 'pass';
  return {
    allowed: false,
    requirements: [
      { id: 'controllerIdentityVerified', met: args.controller.idProvenance === 'vehicle' },
      { id: 'fileCompatible', met: compat },
      { id: 'originalVerified', met: !!args.integrity?.ok },
      { id: 'checksumVerified', met: false },
      { id: 'voltageStable', met: false },
      { id: 'safetyChecksPassed', met: noFail },
      { id: 'explicitApproval', met: args.approved },
      { id: 'hardwareWriteCapable', met: false },
      { id: 'verifiedWriteImplementation', met: false },
      { id: 'verifiedRestore', met: false },
    ],
  };
}
