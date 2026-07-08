import net from 'node:net';

const url = new URL(process.env.DATABASE_URL);
const host = url.hostname;
const port = Number(url.port) || 5432;
const maxAttempts = Number(process.env.POSTGRES_WAIT_TIMEOUT ?? 60);

function tryConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

let attempt = 0;
while (attempt < maxAttempts) {
  attempt += 1;
  if (await tryConnect()) {
    console.log(`wait-for-postgres: connected to ${host}:${port}`);
    process.exit(0);
  }
  console.log(`wait-for-postgres: postgres not ready (${attempt}/${maxAttempts}), retrying...`);
  await new Promise((r) => setTimeout(r, 1000));
}

console.error(`wait-for-postgres: timed out after ${maxAttempts}s waiting for ${host}:${port}`);
process.exit(1);
