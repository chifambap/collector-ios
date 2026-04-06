// constants.js — static lookup tables, no dependencies

// Baked into the APK at build time. Server's version_code is compared against this.
export const APP_VERSION_CODE = 2;

export const CROP_COLORS = {
  maize: '#f97316', tobacco: '#6b7280', sesame: '#d4d4d8', sorghum: '#d97706',
  cotton: '#cbd5e1', pearl_millet: '#78716c', groundnut: '#b45309', soyabean: '#8b5cf6',
  finger_millet: '#a8a29e', potato: '#92400e', sunflower: '#eab308', tea: '#65a30d',
  pepper: '#dc2626', roundnut: '#d97706', sugarcane: '#10b981', cabbage: '#84cc16',
  banana: '#fde047', tomato: '#ef4444', sugarbean: '#c026d3', macademia: '#78350f',
  bambaranuts: '#fcd34d', cowpea: '#4ade80', paprika: '#ea580c', rice: '#3b82f6',
  cassava: '#9a3412', chick_pea: '#facc15', pigeon_pea: '#a3e635', summer_wheat: '#f4c430',
  caster_beans: '#57534e', cocoyam: '#a855f7', tsenza: '#d946ef',
  wheat: '#d4a017', barley: '#b8860b', pea: '#22c55e', other: '#64748b'
};

export const CROP_EMOJI = {
  maize: '🌽', tobacco: '🍃', sesame: '🌿', sorghum: '🌾', cotton: '☁️', pearl_millet: '🌾',
  groundnut: '🥜', soyabean: '🫘', finger_millet: '🌾', potato: '🥔', sunflower: '🌻',
  tea: '🍵', pepper: '🌶️', roundnut: '🥜', sugarcane: '🎋', cabbage: '🥬', banana: '🍌',
  tomato: '🍅', sugarbean: '🫘', macademia: '🌰', bambaranuts: '🥜', cowpea: '🫛',
  paprika: '🌶️', rice: '🍚', cassava: '🍠', chick_pea: '🫘', pigeon_pea: '🫛',
  summer_wheat: '🌾', caster_beans: '🫘', cocoyam: '🍠', tsenza: '🍠',
  wheat: '🌾', barley: '🌾', pea: '🫛', other: '🌿'
};
