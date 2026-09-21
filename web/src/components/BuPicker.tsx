import { Fragment } from 'react';
import { useApp } from '../context/AppContext';
import type { BusinessUnit } from '../types/api';

/**
 * The unit strip - the business unit selector, drawn as the hierarchy it is.
 *
 * It is the most-used control in the application, so every unit the user may
 * read is one click away rather than behind a dropdown, and the tree shape is
 * visible: VISL is the root, ESL and FACOR are reporting units, and IOB is a
 * roll-up whose four units sit inside its bracket. That makes it obvious at a
 * glance which figures are consolidated and which are where the work sits.
 *
 * It renders only what the signed-in user may read. An IOK owner sees one
 * label and nothing to choose; the IOB PMO sees IOB and its four units; the
 * CEO sees the whole tree.
 */

const parentOf = (u: BusinessUnit) => u.parent_code ?? u.parent ?? null;
const isRollup = (u: BusinessUnit) => !!(u.is_consolidated ?? u.consolidated);

export function UnitStrip() {
  const { session, bu, setBu } = useApp();
  const units = session.businessUnits;
  const codes = new Set(units.map((u) => u.code));
  // Roots are units whose parent is not visible to this user.
  const roots = units.filter((u) => !parentOf(u) || !codes.has(parentOf(u)!));
  const childrenOf = (code: string) => units.filter((u) => parentOf(u) === code);
  const selected = units.find((u) => u.code === bu);

  const pill = (u: BusinessUnit, extra = '') => (
    <button
      key={u.code}
      type="button"
      className={`unit-pill ${bu === u.code ? 'active' : ''} ${isRollup(u) ? 'rollup' : ''} ${extra}`}
      onClick={() => setBu(u.code)}
      title={`${u.name}${isRollup(u) ? ' — consolidated roll-up' : ''}`}
      aria-pressed={bu === u.code}
    >
      <i className="swatch" style={{ background: u.accent }} />
      {u.code}
    </button>
  );

  const renderBranch = (u: BusinessUnit): JSX.Element => {
    const kids = childrenOf(u.code);
    if (!kids.length) return pill(u);
    return (
      <span className={`unit-branch depth-${roots.includes(u) ? 0 : 1}`} key={u.code}>
        {pill(u)}
        <span className="unit-arrow" aria-hidden="true">›</span>
        <span className="unit-kids">
          {kids.map((k) => <Fragment key={k.code}>{renderBranch(k)}</Fragment>)}
        </span>
      </span>
    );
  };

  return (
    <div className="unit-strip no-print">
      <div className="unit-strip-inner">
        <span className="unit-caption">Business unit</span>
        {units.length <= 1
          ? <span className="unit-single">{selected ? `${selected.code} · ${selected.name}` : bu}</span>
          : <div className="unit-tree">{roots.map(renderBranch)}</div>}
        <span className="unit-context">
          {selected && <b>{selected.name}</b>}
          {selected && isRollup(selected) && <span className="rollup-tag">Consolidated</span>}
        </span>
      </div>
    </div>
  );
}

/** The reporting window, stated in the header so it is never in doubt. */
export function WindowNote({ label, closedCount, totalCount }: { label: string; closedCount?: number; totalCount?: number }) {
  return (
    <span className="nowrap" title="Booked figures include approved actuals only">
      {label}
      {closedCount !== undefined && totalCount !== undefined && (
        <span className="dim"> · {closedCount} of {totalCount} months closed</span>
      )}
    </span>
  );
}
