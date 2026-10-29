// Both implementations use Redis-compatible commands. Mutation leases prevent
// overlapping cron jobs from racing counters, cursors or the spend guard.
export class MemoryStore {
  constructor(now = () => Date.now()) { this.data = new Map(); this.now = now; }
  async command(...args) {
    const [op, key, ...rest] = args;
    let item = this.data.get(key);
    if (item?.expires && item.expires <= this.now()) { this.data.delete(key); item = undefined; }
    if (op === 'GET') return item?.value ?? null;
    if (op === 'SET') {
      if (rest.includes('NX') && item) return null;
      const ex = rest.indexOf('EX');
      this.data.set(key, {value: rest[0], expires: ex < 0 ? null : this.now() + Number(rest[ex + 1]) * 1000}); return 'OK';
    }
    if (op === 'DEL') return Number(this.data.delete(key));
    if (op === 'EVAL') { if (item?.value === rest[0]) return this.command('DEL', key); return 0; }
    if (op === 'INCRBYFLOAT' || op === 'INCR') {
      const value = Number(item?.value || 0) + (op === 'INCR' ? 1 : Number(rest[0]));
      this.data.set(key, {value: String(value), expires: item?.expires}); return String(value);
    }
    if (op === 'LPUSH') { const value = [rest[0], ...(item?.value || [])]; this.data.set(key, {value}); return value.length; }
    if (op === 'LTRIM') { if (item) item.value = item.value.slice(Number(rest[0]), Number(rest[1]) + 1); return 'OK'; }
    if (op === 'LRANGE') return (item?.value || []).slice(Number(rest[0]), Number(rest[1]) < 0 ? undefined : Number(rest[1]) + 1);
    throw new Error('unsupported_store_command');
  }
  async get(key) { return this.command('GET', key); }
  async set(key, value, ttl) { return this.command('SET', key, value, ...(ttl ? ['EX', ttl] : [])); }
  async add(key, value) { return Number(await this.command('INCRBYFLOAT', key, value)); }
  async list(key, limit = 20) { return (await this.command('LRANGE', key, 0, limit - 1)).map(JSON.parse); }
  async append(key, value, limit) { await this.command('LPUSH', key, JSON.stringify(value)); if (limit) await this.command('LTRIM', key, 0, limit - 1); }
  async lock(token) { return this.command('SET', 'job:lock', token, 'NX', 'EX', 900); }
  async unlock(token) { return this.command('EVAL', 'job:lock', token); }
}
export class RedisStore extends MemoryStore {
  constructor(env, fetchImpl = fetch) {
    super(); this.url = env.UPSTASH_REDIS_REST_URL; this.token = env.UPSTASH_REDIS_REST_TOKEN; this.fetch = fetchImpl;
    if (!this.url || !this.token) throw new Error('redis_configuration_required');
  }
  async command(...args) {
    if (args[0] === 'EVAL') args = ['EVAL', 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end', 1, args[1], args[2]];
    const response = await this.fetch(this.url, {method:'POST', headers:{Authorization:`Bearer ${this.token}`, 'Content-Type':'application/json'}, body:JSON.stringify(args), signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('store_http_error');
    const data = await response.json(); if (data.error) throw new Error('store_command_error'); return data.result;
  }
}
