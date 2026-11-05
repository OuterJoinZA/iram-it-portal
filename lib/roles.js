// ──────────────────────────────────────────────────────────────────────────────
// Role → permission map. These permissions gate everything under /api/admin:
//   manageUsers      create/edit/deactivate accounts (Super Admin only)
//   editHR           save changes via the HR page editor
//   editIT           IT config: categories, smart priority, staff list
//   manageTickets    the ticket dashboard and everything under it
//   viewTicketStats  read-only ticket analytics (admin/hr-dashboard.html)
//   previewUsers     "Preview as" another user/role in TEST mode (dev & bug-testing) —
//                    Developer and Super Admin only, never Admin or IT
//   updateAccounts   New Starter Queue as the Perigee support admin: see every
//                    request, record real Perigee / Dext / Microsoft usernames,
//                    tick accounts created and send logins — but not change
//                    status, IT notes or bookings, and only before completion
//   requestAccounts  log a verified new-starter Email / Perigee account request
//                    (admin/account-request.html). The request is tied to the
//                    signed-in account, which is what proves it came from HR.
//
// Adding a new department/role is a one-line addition to ROLES below — nothing
// else needs to change.
// ──────────────────────────────────────────────────────────────────────────────
const ROLES = {
  developer:       { label: 'Developer',        permissions: ['manageUsers', 'editHR', 'editIT', 'manageTickets', 'viewTicketStats', 'requestAccounts', 'previewUsers'] },
  super_admin:     { label: 'Super Admin',      permissions: ['manageUsers', 'editHR', 'editIT', 'manageTickets', 'viewTicketStats', 'requestAccounts', 'previewUsers'] },
  admin:           { label: 'Admin',            permissions: ['editHR', 'editIT', 'manageTickets', 'viewTicketStats', 'requestAccounts'] },
  hr_admin:        { label: 'HR Admin',         permissions: ['editHR', 'viewTicketStats', 'requestAccounts'] },
  it:              { label: 'IT',               permissions: ['manageTickets', 'viewTicketStats'] },
  hr_manager:      { label: 'HR Manager',       permissions: ['editHR', 'viewTicketStats', 'requestAccounts'] },
  hr:              { label: 'HR',               permissions: ['editHR', 'viewTicketStats', 'requestAccounts'] },
  assistant_hr:    { label: 'Assistant HR',     permissions: ['editHR', 'viewTicketStats', 'requestAccounts'] },
  perigee_admin:   { label: 'Perigee Support Admin', permissions: ['updateAccounts'] },
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
