import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Tests boot a real Express server + a fresh SQLite DB per file.
    // Running them in parallel processes would step on each other's CWD
    // (db/client.ts resolves the DB path against process.cwd()).
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
