// Entirely fictional fixtures. These are NOT verified Siege equipment restrictions.
export const mockDatabase = {
  schemaVersion: 1,
  dataVersion: { id: 'mock-fixtures-v1', kind: 'mock', verifiedPatch: null },
  attachments: {
    none: { name: 'No attachment' },
    'mock-dot': { name: 'Demo dot sight' },
    'mock-scope': { name: 'Demo magnified sight' },
    'mock-brake': { name: 'Demo muzzle brake' },
    'mock-suppressor': { name: 'Demo suppressor' },
    'mock-grip': { name: 'Demo vertical grip' },
    'mock-laser': { name: 'Demo laser' },
  },
  categories: {
    rifle: { optic: ['none', 'mock-dot', 'mock-scope'], barrel: ['none', 'mock-brake', 'mock-suppressor'], grip: ['none', 'mock-grip'], underbarrel: ['none', 'mock-laser'] },
    compact: { optic: ['none', 'mock-dot'], barrel: ['none', 'mock-suppressor'], grip: ['none', 'mock-grip'], underbarrel: ['none', 'mock-laser'] },
    shotgun: { optic: ['none', 'mock-dot'], barrel: [], grip: [], underbarrel: ['none', 'mock-laser'] },
    pistol: { optic: ['none'], barrel: ['none', 'mock-brake'], grip: [], underbarrel: ['none', 'mock-laser'] },
  },
  weapons: {
    'demo-rifle': { name: 'Demo R-01', category: 'rifle', slot: 'primary', attachmentOverrides: { barrel: ['none', 'mock-brake'] } },
    'demo-compact': { name: 'Demo C-02', category: 'compact', slot: 'primary', attachmentOverrides: { grip: [] } },
    'demo-shotgun': { name: 'Demo S-03', category: 'shotgun', slot: 'primary' },
    'demo-pistol': { name: 'Demo P-01', category: 'pistol', slot: 'secondary' },
    'demo-sidearm': { name: 'Demo P-02', category: 'pistol', slot: 'secondary', attachmentOverrides: { barrel: [], underbarrel: [] } },
  },
  gadgets: {
    'demo-smoke': { name: 'Demo smoke device' },
    'demo-breach': { name: 'Demo breach device' },
    'demo-alarm': { name: 'Demo proximity alarm' },
    'demo-shield': { name: 'Demo deployable cover' },
  },
  operators: [
    { id: 'demo-vector', name: 'Vector', side: 'attack', primary: ['demo-rifle', 'demo-shotgun'], secondary: ['demo-pistol', 'demo-sidearm'], gadgets: ['demo-smoke', 'demo-breach'], attachmentOverrides: { 'demo-rifle': { optic: ['mock-dot'] } } },
    { id: 'demo-drift', name: 'Drift', side: 'attack', primary: ['demo-rifle'], secondary: ['demo-pistol'], gadgets: ['demo-breach'] },
    { id: 'demo-bastion', name: 'Bastion', side: 'defense', primary: ['demo-compact', 'demo-shotgun'], secondary: ['demo-pistol'], gadgets: ['demo-alarm', 'demo-shield'], attachmentOverrides: { 'demo-compact': { optic: ['none'] } } },
    { id: 'demo-relay', name: 'Relay', side: 'defense', primary: ['demo-compact'], secondary: ['demo-sidearm'], gadgets: ['demo-alarm'] },
  ],
};
