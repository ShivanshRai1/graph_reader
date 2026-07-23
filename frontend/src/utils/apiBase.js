/**
 * Graph Capture API routing: Render first, DigitalOcean as backup.
 *
 * Render is primary (long AI extraction waits, no Netlify proxy timeout).
 * DO is reached via same-origin `/do-api` when Render is down or for failover.
 */

const DO_DIRECT = 'http://165.22.212.92:8010';
const DO_VIA_NETLIFY_PROXY = '/do-api';
const RENDER_PRIMARY = 'https://graph-reader-0ot9.onrender.com';

const CACHE_KEY = 'graphCapture.apiBaseUrl';
const HEALTH_TIMEOUT_MS = 2500;

const stripSlash = (url) => String(url || '').trim().replace(/\/$/, '');

const isRenderUrl = (url) => /onrender\.com/i.test(String(url || ''));

/** Primary (Render) URL without consulting session failover cache. */
export const getPrimaryApiUrl = () => {
  const explicitPrimary = stripSlash(
    import.meta.env.VITE_API_PRIMARY_URL || ''
  );
  if (explicitPrimary) return explicitPrimary;

  if (import.meta.env.DEV) {
    const envUrl = stripSlash(import.meta.env.VITE_API_URL || '');
    if (envUrl && !isRenderUrl(envUrl)) return envUrl;
    return 'http://localhost:8000';
  }

  const envUrl = stripSlash(import.meta.env.VITE_API_URL || '');
  if (envUrl) return envUrl;

  return RENDER_PRIMARY;
};

export const getBackupApiUrl = () => {
  const explicit = stripSlash(import.meta.env.VITE_API_BACKUP_URL || '');
  if (explicit) return explicit;

  return DO_VIA_NETLIFY_PROXY;
};

export const getPreferredApiUrlSync = () => {
  if (typeof window !== 'undefined') {
    try {
      const cached = stripSlash(sessionStorage.getItem(CACHE_KEY));
      if (cached) return cached;
    } catch {
      /* ignore */
    }
  }
  return getPrimaryApiUrl();
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

const probeHealth = async (baseUrl, timeoutMs = HEALTH_TIMEOUT_MS) => {
  const base = stripSlash(baseUrl);
  if (!base) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

let resolveInFlight = null;

/**
 * Pick a live API base: Render (primary), else DO via /do-api (backup).
 * Always tries Render first — session cache only skips a second probe after success.
 */
export const resolveApiUrl = async ({ force = false } = {}) => {
  if (resolveInFlight && !force) return resolveInFlight;

  resolveInFlight = (async () => {
    const primary = getPrimaryApiUrl();
    const backupEnv = stripSlash(import.meta.env.VITE_API_BACKUP_URL || '');
    const backup = getBackupApiUrl();

    if (!force && typeof window !== 'undefined') {
      try {
        const cached = stripSlash(sessionStorage.getItem(CACHE_KEY));
        if (cached && cached === primary && (await probeHealth(cached, 1200))) {
          return cached;
        }
      } catch {
        /* ignore */
      }
    }

    const candidates = import.meta.env.DEV
      ? [primary, backupEnv].filter(
          (url, index, all) => url && all.indexOf(url) === index
        )
      : force
        ? [RENDER_PRIMARY, DO_VIA_NETLIFY_PROXY, DO_DIRECT].filter(
            (url, index, all) => url && all.indexOf(url) === index
          )
        : [primary, backup].filter(
            (url, index, all) => url && all.indexOf(url) === index
          );

    for (const candidate of candidates) {
      if (await probeHealth(candidate)) {
        return remember(candidate);
      }
    }

    return remember(primary);
  })();

  try {
    return await resolveInFlight;
  } finally {
    resolveInFlight = null;
  }
};

/**
 * If a request to the current base fails with a network error, switch to backup
 * and return the new base (or null if already on backup / no switch).
 */
export const failoverApiUrl = async (failedBaseUrl) => {
  const failed = stripSlash(failedBaseUrl);
  const backup = getBackupApiUrl();
  if (!backup || backup === failed) return null;
  if (!(await probeHealth(backup))) return null;
  return remember(backup);
};

export const API_BASE_DEFAULTS = {
  doDirect: DO_DIRECT,
  doProxy: DO_VIA_NETLIFY_PROXY,
  renderPrimary: RENDER_PRIMARY,
};
