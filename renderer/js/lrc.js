// LRC parser: standard [mm:ss.xx] lines, several timestamps per line, [offset:], and
// "enhanced" LRC with per-word <mm:ss.xx> stamps. Unsynced text is returned line by line.

const TS = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TS = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function toMs(m, s, frac) {
  let ms = 0;
  if (frac != null) ms = frac.length === 1 ? Number(frac) * 100 : frac.length === 2 ? Number(frac) * 10 : Number(frac);
  return (Number(m) * 60 + Number(s)) * 1000 + ms;
}

function parseWords(body) {
  if (!/<\d{1,3}:\d{1,2}/.test(body)) return null;
  const words = [];
  const re = new RegExp(WORD_TS.source, 'g');
  let last = null;
  let idx = 0;
  let m;
  while ((m = re.exec(body))) {
    const chunk = body.slice(idx, m.index);
    if (last && chunk) words.push({ t: last.t, text: chunk });
    last = { t: toMs(m[1], m[2], m[3]) };
    idx = m.index + m[0].length;
  }
  const tail = body.slice(idx);
  if (last && tail) words.push({ t: last.t, text: tail });
  return words.length ? words : null;
}

export function parseLrc(raw) {
  const text = String(raw || '').replace(/\r/g, '');
  const lines = [];
  let offset = 0;
  let synced = false;

  for (const line of text.split('\n')) {
    const offsetTag = line.match(/^\[offset:\s*([+-]?\d+)\]/i);
    if (offsetTag) { offset = Number(offsetTag[1]); continue; }
    if (/^\[[a-z]{2,}:/i.test(line) && !/^\[\d/.test(line)) continue; // [ti:], [ar:], [al:] ...

    const stamps = [];
    const re = new RegExp(TS.source, 'g');
    let m;
    let end = 0;
    while ((m = re.exec(line)) && m.index === end) { stamps.push(toMs(m[1], m[2], m[3])); end = re.lastIndex; }
    const body = line.slice(end);

    if (stamps.length) {
      synced = true;
      const words = parseWords(body);
      const clean = body.replace(new RegExp(WORD_TS.source, 'g'), '').trim();
      for (const t of stamps) lines.push({ t, text: clean, words: words ? words.map((w) => ({ ...w })) : null });
    } else if (line.trim() !== '' || lines.length) {
      lines.push({ t: null, text: line.trim() });
    }
  }

  if (synced) {
    const timed = lines.filter((l) => l.t != null).sort((a, b) => a.t - b.t);
    for (const l of timed) { l.t = Math.max(0, l.t + offset); if (l.words) for (const w of l.words) w.t += offset; }
    for (let i = 0; i < timed.length; i++) timed[i].end = i + 1 < timed.length ? timed[i + 1].t : timed[i].t + 5000;
    return { synced: true, lines: timed };
  }
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  return { synced: false, lines };
}

// Index of the last line whose start time is <= posMs (-1 before the first line).
export function activeIndex(lines, posMs) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= posMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
