/**
 * Graph Capture API routing: DigitalOcean first, Render as backup.
 *
 * Production Netlify is HTTPS, so the browser talks to same-origin `/do-api`
 * (proxied to DO). Direct http://DO would be blocked as mixed content.
 */

const DO_DIRECT = 'http://165.22.212.92:8010';
const DO_VIA_NETLIFY_PROXY = '/do-api';
const RENDER_BACKUP = 'https://graph-reader-0ot9.onrender.com';

const CACHE_KEY = 'graphCapture.apiBaseUrl';
const HEALTH_TIMEOUT_MS = 2500;

const stripSlash = (url) => String(url || '').trim().replace(/\/$/, '');

const isRenderUrl = (url) => /onrender\.com/i.test(String(url || ''));

/** Primary (DO) URL without consulting session failover cache. */
export const getPrimaryApiUrl = () => {
  const explicitPrimary = stripSlash(
    import.meta.env.VITE_API_PRIMARY_URL || ''
  );
  if (explicitPrimary) return explicitPrimary;

  if (import.meta.env.DEV) {
    const envUrl = stripSlash(import.meta.env.VITE_API_URL || '');
    // In local_dev prefer localhost; don't force DO unless asked.
    if (envUrl && !isRenderUrl(envUrl)) return envUrl;
    return 'http://localhost:8000';
  }

  // Production: DO via HTTPS proxy. Ignore legacy VITE_API_URL=Render as primary.
  const envUrl = stripSlash(import.meta.env.VITE_API_URL || '');
  if (envUrl && !isRenderUrl(envUrl)) return envUrl;
  return DO_VIA_NETLIFY_PROXY;
};

export const getBackupApiUrl = () => {
  const explicit = stripSlash(import.meta.env.VITE_API_BACKUP_URL || '');
  if (explicit) return explicit;

  const envUrl = stripSlash(import.meta.env.VITE_API_URL || '');
  if (isRenderUrl(envUrl)) return envUrl;

  return RENDER_BACKUP;
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
 * Pick a live API base: DigitalOcean (primary), else Render (backup).
 * Always tries DO first — session cache only skips a second probe after success.
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
        // Reuse cached ONLY when it is still the DO primary (healthy preference).
        if (cached && cached === primary && (await probeHealth(cached, 1200))) {
          return cached;
        }
      } catch {
        /* ignore */
      }
    }

    // Local: only probe backup when explicitly configured (avoid surprise Render).
    const candidates = import.meta.env.DEV
      ? [primary, backupEnv].filter(
          (url, index, all) => url && all.indexOf(url) === index
        )
      : force
        ? [DO_VIA_NETLIFY_PROXY, DO_DIRECT, backup].filter(
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

    // Neither answered — stick with primary so errors stay attributable.
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
  renderBackup: RENDER_BACKUP,
};
