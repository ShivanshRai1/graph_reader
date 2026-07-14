/**
 * RC Ladder app routing: DigitalOcean first, Render as backup.
 * Used when Graph Capture returns to the ladder after fit/export.
 *
 * Health probes use same-origin `/rc-ladder-proxy` on Netlify so HTTPS pages
 * can check the HTTP DO host without mixed-content blocks. Navigation still
 * uses absolute DO/Render origins (top-level redirects to http are allowed).
 */

const DO_RC_LADDER = 'http://165.22.212.92:8020';
const DO_RC_LADDER_PROBE = '/rc-ladder-proxy';
const RENDER_RC_LADDER = 'https://spice-ladder-sim.onrender.com';

const CACHE_KEY = 'graphCapture.rcLadderBaseUrl';
const HEALTH_TIMEOUT_MS = 2500;

const stripSlash = (url) => String(url || '').trim().replace(/\/$/, '');

export const getPrimaryRcLadderUrl = () => {
  const explicit = stripSlash(import.meta.env?.VITE_RC_LADDER_PRIMARY_URL || '');
  if (explicit) return explicit;
  return DO_RC_LADDER;
};

export const getBackupRcLadderUrl = () => {
  const explicit = stripSlash(import.meta.env?.VITE_RC_LADDER_BACKUP_URL || '');
  if (explicit) return explicit;
  return RENDER_RC_LADDER;
};

/** Same-origin probe target for production Netlify → DO. */
const getPrimaryProbeUrl = () => {
  if (import.meta.env?.DEV) return getPrimaryRcLadderUrl();
  const explicit = stripSlash(import.meta.env?.VITE_RC_LADDER_PRIMARY_URL || '');
  // Custom absolute primary: probe it directly when not our DO HTTP host.
  if (explicit && !/^http:\/\/165\.22\.212\.92:8020$/i.test(explicit)) {
    return explicit;
  }
  return DO_RC_LADDER_PROBE;
};

export const getPreferredRcLadderUrlSync = () => {
  if (typeof window !== 'undefined') {
    try {
      const cached = stripSlash(sessionStorage.getItem(CACHE_KEY));
      if (cached) return cached;
    } catch {
      /* ignore */
    }
  }
  return getPrimaryRcLadderUrl();
};

const remember = (url) => {
  const cleaned = stripSlash(url);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(CACHE_KEY, cleaned);
    }
  } catch {
    /* ignore */
  }
  return cleaned;
};

const probeRcLadder = async (baseUrl, timeoutMs = HEALTH_TIMEOUT_MS) => {
  const base = stripSlash(baseUrl);
  if (!base) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      mode: 'cors',
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

let resolveInFlight = null;

export const resolveRcLadderUrl = async ({ force = false } = {}) => {
  if (resolveInFlight && !force) return resolveInFlight;

  resolveInFlight = (async () => {
    const primary = getPrimaryRcLadderUrl();
    const backup = getBackupRcLadderUrl();
    const primaryProbe = getPrimaryProbeUrl();

    if (!force && typeof window !== 'undefined') {
      try {
        const cached = stripSlash(sessionStorage.getItem(CACHE_KEY));
        if (cached && cached === primary) {
          const probeForCached = cached === DO_RC_LADDER ? primaryProbe : cached;
          if (await probeRcLadder(probeForCached, 1200)) return cached;
        }
      } catch {
        /* ignore */
      }
    }

    if (await probeRcLadder(primaryProbe)) return remember(primary);
    if (await probeRcLadder(backup)) return remember(backup);
    return remember(primary);
  })();

  try {
    return await resolveInFlight;
  } finally {
    resolveInFlight = null;
  }
};

/** True when URL is our DO or Render RC Ladder host. */
export const isKnownRcLadderUrl = (url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (/spice-ladder-sim\.onrender\.com$/i.test(parsed.hostname)) return true;
    if (parsed.hostname === '165.22.212.92' && String(parsed.port || '') === '8020') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * If `url` points at DO/Render RC Ladder, swap origin to the preferred live base.
 * Leaves DiscoverEE / other hosts untouched.
 */
export const rewriteRcLadderUrl = (url, preferredBase = getPreferredRcLadderUrlSync()) => {
  const raw = String(url || '').trim();
  if (!raw || !isKnownRcLadderUrl(raw)) return raw;
  try {
    const incoming = new URL(raw);
    const base = new URL(stripSlash(preferredBase) || getPrimaryRcLadderUrl());
    return `${base.origin}${incoming.pathname}${incoming.search}${incoming.hash}`;
  } catch {
    return raw;
  }
};

export const RC_LADDER_DEFAULTS = {
  doPrimary: DO_RC_LADDER,
  doProbe: DO_RC_LADDER_PROBE,
  renderBackup: RENDER_RC_LADDER,
};
