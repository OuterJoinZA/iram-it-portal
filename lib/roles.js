// ──────────────────────────────────────────────────────────────────────────────
// Role → permission map. Four permissions gate everything under /api/admin:
//   manageUsers    create/edit/deactivate accounts (Super Admin only)
//   editHR         save changes via the HR page editor
//   editIT         IT config: categories, smart priority, staff list
//   manageTickets  the ticket dashboard and everything under it
//
// Adding a new department/role is a one-line addition to ROLES below — nothing
// else needs to change.
// ──────────────────────────────────────────────────────────────────────────────
const ROLES = {
  super_admin:     { label: 'Super Admin',      permissions: ['manageUsers', 'editHR', 'editIT', 'manageTickets'] },
  admin:           { label: 'Admin',            permissions: ['editHR', 'editIT', 'manageTickets'] },
  hr_admin:        { label: 'HR Admin',         permissions: ['editHR'] },
  it:              { label: 'IT',               permissions: ['manageTickets'] },
  hr_manager:      { label: 'HR Manager',       permissions: [] },
  hr:              { label: 'HR',               permissions: [] },
  assistant_hr:    { label: 'Assistant HR',     permissions: [] },
  field_goosehelp: { label: 'Field GooseHelp',  permissions: [] },
  staff:           { label: 'Staff',            permissions: [] }
};

function hasPermission(role, permission) {
  const r = ROLES[role];
  return !!r && r.permissions.includes(permission);
}

function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

function listRoles() {
  return Object.keys(ROLES).map(key => ({ key, label: ROLES[key].label, permissions: ROLES[key].permissions }));
}

module.exports = { ROLES, hasPermission, isValidRole, listRoles };
