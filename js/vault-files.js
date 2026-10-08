/* ============================================================================
 *  ATC Vault files: the tree builder (wave 8 PR 2, docs/vault-hub/wave8/02-files-and-picker.md)
 *
 *  One pure module the Hub's Files tab and the client library's picker share, so
 *  the same list of GET /api/projects/:id/files builds the same tree in both.
 *  No DOM, no dependencies, works in Node (test/vault-files.test.mjs).
 *
 *    buildTree(files) -> { name:'', path:'', group:null, folders:[…], files:[…], count }
 *      A folder: { name, path, group, folders, files, count }. WorkDrive paths nest as
 *      given ("Alpha technical / Parker Creek/Reserves VDR/Logs": the first segment is
 *      the mapped folder's display name, whose " / " is not a separator). Files with no
 *      path sit in a group per source after the real folders: Uploaded, Mail, Research, Other.
 *    kindOf(file)  -> 'pdf' | 'sheet' | 'image' | 'mail' | 'doc' | 'other'
 *    matches(file, term, kinds) -> the find box and the type chips, applied before buildTree
 * ========================================================================== */

/** Groups for files that did not come from a WorkDrive folder, in display order, keyed by origin.source family. */
export const GROUPS = {
  upload: { en: 'Uploaded', es: 'Subidos' },
  mail: { en: 'Mail', es: 'Correo' },
  research: { en: 'Research', es: 'Investigación' },
  other: { en: 'Other', es: 'Otros' },
};
const GROUP_ORDER = ['upload', 'mail', 'research', 'other'];

export const KINDS = {
  pdf: { en: 'PDF', es: 'PDF' }, sheet: { en: 'Sheet', es: 'Hoja' }, image: { en: 'Image', es: 'Imagen' },
  mail: { en: 'Mail', es: 'Correo' }, doc: { en: 'Document', es: 'Documento' }, other: { en: 'Other', es: 'Otros' },
};

/** A WorkDrive path split into folder names: "/" separates, " / " inside a name does not. */
export function splitPath(path) {
  if (typeof path !== 'string' || !path.trim()) return [];
  return path.split(/(?<!\s)\/(?!\s)/).map((s) => s.trim()).filter(Boolean);
}

export function groupOf(file) {
  const s = String((file && file.source) || '').toLowerCase();
  const t = String((file && file.type) || '').toLowerCase();
  if (t === 'email' || /mail|gmail|imap/.test(s)) return 'mail';
  if (s === 'upload' || s === 'hub' || s === 'draft') return 'upload';
  if (/research|worldmonitor|openalex|semantic|crossref|gem|miner|web/.test(s)) return 'research';
  return 'other';
}

const EXT = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };

export function kindOf(file) {
  const mime = String((file && file.mime) || '').toLowerCase();
  const ext = EXT(file && file.name);
  const type = String((file && file.type) || '').toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (/spreadsheet|ms-excel|text\/csv/.test(mime) || /^(xlsx|xlsm|xls|csv)$/.test(ext) || type === 'spreadsheet') return 'sheet';
  if (mime.startsWith('image/') || /^(png|jpe?g|gif|webp|tiff?|bmp|svg)$/.test(ext)) return 'image';
  if (mime === 'message/rfc822' || /^(eml|msg)$/.test(ext) || type === 'email') return 'mail';
  if (/^(zip|7z|rar|gz|tgz|tar|las|dlis|lis|segy|sgy|blb|dat|bin|db|pds|prj)$/.test(ext) || /zip|octet-stream|x-las/.test(mime)) return 'other';
  if (/wordprocessing|msword|presentation|text\/(plain|markdown)/.test(mime) || /^(docx?|pptx?|txt|md|rtf)$/.test(ext) || /^(letter|report|note|memo|contract|nda)$/.test(type)) return 'doc';
  return 'other';
}

/** The find box (a substring of the name or title, case-insensitive) and the kind chips (a Set, or null for all). */
export function matches(file, term, kinds) {
  if (kinds && kinds.size && !kinds.has(kindOf(file))) return false;
  const t = String(term || '').trim().toLowerCase();
  if (!t) return true;
  return String(file.name || '').toLowerCase().includes(t) || String(file.title || '').toLowerCase().includes(t);
}

const collator = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) : { compare: (a, b) => (a < b ? -1 : a > b ? 1 : 0) };
const byName = (a, b) => collator.compare(a.name, b.name) || String(a.id || '').localeCompare(String(b.id || ''));
const folder = (name, path, group) => ({ name, path, group, folders: [], files: [], count: 0 });

export function buildTree(files) {
  const root = folder('', '', null);
  const groups = new Map();
  for (const file of files || []) {
    const parts = splitPath(file.path);
    if (parts.length) {
      let node = root;
      for (const part of parts) {
        let next = node.folders.find((d) => d.name === part);
        if (!next) { next = folder(part, node.path ? node.path + '/' + part : part, null); node.folders.push(next); }
        node = next;
      }
      node.files.push(file);
    } else {
      const g = groupOf(file);
      if (!groups.has(g)) groups.set(g, folder(GROUPS[g].en, '', g));
      groups.get(g).files.push(file);
    }
  }
  const finish = (node) => {
    node.folders.sort(byName);
    node.files.sort(byName);
    node.count = node.files.length;
    for (const d of node.folders) node.count += finish(d);
    return node.count;
  };
  finish(root);
  for (const g of GROUP_ORDER) if (groups.has(g)) { const d = groups.get(g); finish(d); root.folders.push(d); root.count += d.count; }
  return root;
}

export function fmtSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}
