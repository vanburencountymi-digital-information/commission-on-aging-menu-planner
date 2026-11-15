import postgres from 'postgres';

// postgres.js parses DATABASE_URL using Node's URL class, which sets
// host = hostname *after* spreading searchParams — so ?host=/cloudsql/...
// is always overridden by the TCP hostname. We parse manually so the
// Cloud SQL Unix socket path is respected in Cloud Run, while the
// standard localhost:PORT format still works for local dev via Auth Proxy.
function parseConfig(url) {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  // Unix-socket connections (Cloud Run) are already private. Direct TCP to an
  // instance that enforces TLS needs sslmode=require in the URL or PGSSLMODE.
  const sslMode = u.searchParams.get('sslmode') || process.env.PGSSLMODE;
  return {
    ...(sslMode === 'require' && { ssl: 'require' }),
    host:     socketHost || u.hostname,
    port:     u.port     || 5432,
    database: u.pathname.slice(1),
    username: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  };
}

const sql = postgres(parseConfig(process.env.DATABASE_URL));

export default sql;
