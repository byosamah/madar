/**
 * The global setup of the db project (plan 7.2). Track D1 replaces this stub: as postgres, it drops and makes one schema for each
 * worker and applies the non-platform migrations, and it refuses any database host except 127.0.0.1 and localhost.
 * Until then the db project runs the API tests in memory.
 */
export default async function setup(): Promise<void> {}
