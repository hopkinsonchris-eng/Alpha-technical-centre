// ===========================================================================
// apex-sim · wells/groups
// ---------------------------------------------------------------------------
// Group controls: hierarchical rate targets and allocation of group targets down to member wells (GCONPROD/GCONINJE).
// ===========================================================================

export class Group {
  constructor(name, { parent = null, control = null } = {}) { Object.assign(this, { name, parent, control, members: [] }); }
  /** Allocate a group target across members. */
  allocate(/* target, members */) { /* TODO */ }
}
