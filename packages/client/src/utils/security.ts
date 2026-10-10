// Security & Name Generation Helpers (Phases 1, 3, 6)

const ADJECTIVES = [
  'Swift', 'Calm', 'Amber', 'Brave', 'Golden', 'Silver', 'Cosmic', 'Solar',
  'Lunar', 'Bright', 'Quiet', 'Velvet', 'Noble', 'Clever', 'Wild', 'Gentle',
  'Echo', 'Shadow', 'Frost', 'Spark'
];

const NOUNS = [
  'Falcon', 'Otter', 'Fox', 'Lynx', 'Eagle', 'Hawk', 'Wolf', 'Badger',
  'Tiger', 'Dolphin', 'Panda', 'Raven', 'Cheetah', 'Osprey', 'Koala', 'Seal',
  'Robin', 'Stag', 'Bear', 'Jaguar'
];

export function generateFriendlyDeviceName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

const EXECUTABLE_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'apk', 'msi', 'com', 'scr', 'vbs', 'ps1', 'jar'
]);

export function isExecutableFile(fileName: string): boolean {
  if (!fileName) return false;
  const parts = fileName.split('.');
  if (parts.length < 2) return false;
  const ext = parts[parts.length - 1].toLowerCase();
  return EXECUTABLE_EXTENSIONS.has(ext);
}

// Sanitize filename to prevent directory traversal or reserved characters
export function sanitizeFileName(name: string): string {
  if (!name) return 'downloaded_file';
  // Strip null bytes and control chars
  let clean = name.replace(/[\0\x00-\x1f\x7f]/g, '');
  // Remove directory traversal paths
  clean = clean.replace(/\.\.+[/\\]/g, '');
  clean = clean.replace(/[/\\]/g, '_');
  // Strip dangerous characters on Windows
  clean = clean.replace(/[<>:"|?*]/g, '_').trim();
  return clean || 'downloaded_file';
}

// Calculate SHA-256 of an ArrayBuffer using Web Crypto API (Phase 3 T2)
export async function calculateSha256(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '';
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}
