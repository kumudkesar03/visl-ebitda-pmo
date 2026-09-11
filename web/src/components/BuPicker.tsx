import { useApp } from '../context/AppContext';

/**
 * The business unit selector.
 *
 * This is the most-used control in the application, so it is a single row of
 * always-visible buttons rather than a dropdown: switching from VISL to IOK
 * and back is a two-click comparison, not four clicks through a menu.
 *
 * It renders only what the signed-in user may read. An IOK owner sees one
 * button and no hierarchy at all; the IOB PMO sees IOB and its four units; the
 * CEO sees the whole tree. Consolidated nodes are separated from the reporting
 * units beneath them by a rule, so it stays obvious which figures are
 * roll-ups and which are where the work actually sits.
 */
export function BuPicker() {
  const { session, bu, setBu } = useApp();
  const units = session.businessUnits;
  if (units.length <= 1) return null;

  const rendered: JSX.Element[] = [];
  let lastDepth = -1;

  units.forEach((u) => {
    const consolidated = u.is_consolidated ?? u.consolidated ?? false;
    if (u.depth <= lastDepth && u.depth === 1) {
      rendered.push(<i className="sep" key={`sep-${u.code}`} />);
    }
    rendered.push(
      <button
        key={u.code}
        type="button"
        className={`${bu === u.code ? 'active' : ''} ${u.depth > 1 ? 'child' : ''}`}
        onClick={() => setBu(u.code)}
        title={`${u.name}${consolidated ? ' — consolidated roll-up' : ''}`}
      >
        <i className="dot" style={{ background: u.accent }} />
        {u.code}
      </button>,
    );
    lastDepth = u.depth;
  });

  return <div className="bu-picker">{rendered}</div>;
}

/** The reporting window, stated in the header so it is never in doubt. */
export function WindowNote({ label, closedCount, totalCount }: { label: string; closedCount?: number; totalCount?: number }) {
  return (
    <span className="small muted nowrap" title="Booked figures include approved actuals only">
      {label}
      {closedCount !== undefined && totalCount !== undefined && (
        <span className="dim"> · {closedCount} of {totalCount} months closed</span>
      )}
    </span>
  );
}
