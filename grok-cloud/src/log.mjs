export async function logRun(store, entry) {
  // Never serialize request headers, environment, raw provider errors or bodies.
  await store.append('logs', entry, 5000);
  return entry;
}
