// Catalogue partagé entre le front et le serveur (source unique).

export const STYLES = [
  { id: 'argent', emoji: '💰', label: 'Argent' },
  { id: 'heritage', emoji: '🏛️', label: 'Héritage' },
  { id: 'romance', emoji: '❤️', label: 'Romance' },
  { id: 'trahison', emoji: '🗡️', label: 'Trahison' },
  { id: 'famille', emoji: '👨‍👩‍👧', label: 'Famille' },
  { id: 'mariage', emoji: '💍', label: 'Mariage & belle-famille' },
  { id: 'mystique', emoji: '🔮', label: 'Mystique' },
  { id: 'vengeance', emoji: '⚡', label: 'Vengeance' },
  { id: 'pouvoir', emoji: '👑', label: 'Ambition & pouvoir' },
  { id: 'secrets', emoji: '🤫', label: 'Secrets' },
  { id: 'village', emoji: '🏙️', label: 'Village vs Ville' },
  { id: 'jalousie', emoji: '😤', label: 'Jalousie' },
];

export const MAX_STYLES = 3;

export const EPISODE_COUNT = 10;

export const SPEAKER_COLORS = [
  '#f2c14e',
  '#e07a5f',
  '#81b29a',
  '#7bdff2',
  '#c77dff',
  '#ef476f',
];

export function styleLabel(id) {
  const s = STYLES.find((x) => x.id === id);
  return s ? s.label : id;
}
