export const coverageMatrix = {
  supported: [
    {
      area: 'CRM records',
      details: ['contacts', 'companies', 'deals', 'tickets', 'custom objects by objectId'],
      operations: ['read visible page', 'search visible/list results', 'open record', 'create', 'fill without saving', 'update', 'small batch update'],
    },
    {
      area: 'Visible CRM context',
      details: ['record properties', 'visible tables', 'visible associations', 'visible timeline cards'],
      operations: ['snapshot', 'summarize', 'extract table rows'],
    },
    {
      area: 'Governed writes',
      details: ['side-panel approval', 'Autopilot', 'audit log'],
      operations: ['approve', 'reject', 'poll operation result'],
    },
  ],
  experimental: [
    {
      area: 'Timeline activities',
      details: ['notes', 'tasks', 'calls', 'meetings', 'logged emails'],
      limitation: 'Works when the relevant HubSpot composer is visible or reachable in the current record layout.',
    },
    {
      area: 'Associations',
      details: ['associate a visible/searchable record through the UI'],
      limitation: 'Works when the association control is visible and the target can be selected from the HubSpot UI.',
    },
    {
      area: 'Advanced property controls',
      details: ['dropdowns', 'comboboxes', 'date inputs', 'multi-select-like controls'],
      limitation: 'Best effort because HubSpot changes component markup and account layouts.',
    },
  ],
  outOfScope: [
    'delete records',
    'merge records',
    'bulk delete',
    'permission/user/team administration',
    'workflow editing',
    'large exports',
    'marketing email sending',
    'reports/dashboard authoring',
    'private app/OAuth/API-token management',
  ],
} as const;
