// Original dependency-free JSON-RPC client. The Illustrator server remains an external MIT dependency.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function payload(result) {
  if (result?.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'MCP tool failed');
  const text = result?.content?.find(c => c.type === 'text')?.text;
  if (!text) return result;
  try { const value = JSON.parse(text); if (value?.error || value?.success === false) throw new Error(value.message || text); return value; }
  catch (error) { if (error instanceof SyntaxError) return { text }; throw error; }
}

export class McpClient {
  constructor(entry, { timeoutMs = 90000, onCall, command = process.execPath, args } = {}) {
    this.timeoutMs = timeoutMs;
    this.onCall = onCall;
    this.nextId = 1;
    this.pending = new Map();
    this.failed = false;
    this.unknownOutcome = false;
    this.child = spawn(command, args || [entry], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { this.fail(new Error('Non-JSON MCP stdout')); return; }
      const item = this.pending.get(msg.id);
      if (!item) return;
      this.pending.delete(msg.id); clearTimeout(item.timer);
      if (msg.error) item.reject(new Error(JSON.stringify(msg.error))); else item.resolve(msg.result);
    });
    this.child.stderr.on('data', data => process.stderr.write(data));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error('MCP server exited: ' + code)));
  }
  fail(error) {
    if ([...this.pending.values()].some(item => item.mayMutate)) this.unknownOutcome = true;
    this.failed = true;
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
  request(method, params = {}) {
    if (this.failed) return Promise.reject(new Error('MCP session unusable; inspect the document before starting a new session'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('MCP timeout; operation outcome unknown; do not automatically retry')), this.timeoutMs);
      const mayMutate = method === 'tools/call' && !/^(get_|list_|check_|find_|extract_|convert_coordinate$)/.test(params.name);
      this.pending.set(id, { resolve, reject, timer, mayMutate });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => { if (error) this.fail(error); });
    });
  }
  async start() {
    const init = await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'scientific-illustrator-workbench', version: '0.1.0' } });
    this.serverInfo = init.serverInfo;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await this.request('tools/list');
    this.tools = list.tools;
    return this;
  }
  async call(name, args = {}) {
    if (!this.tools?.some(tool => tool.name === name)) throw new Error('MCP tool unavailable: ' + name);
    const start = Date.now();
    const raw = await this.request('tools/call', { name, arguments: args });
    let data;
    try { data = payload(raw); }
    catch (error) { if (/timed? ?out|timeout|still processing|outcome unknown/i.test(error.message)) this.unknownOutcome = true; throw error; }
    await this.onCall?.({ tool: name, elapsedMs: Date.now() - start, arguments: args, data });
    return data;
  }
  async close() {
    this.child.stdin.end();
    await new Promise(resolve => {
      if (this.child.exitCode !== null) return resolve();
      const timer = setTimeout(() => { this.child.kill(); resolve(); }, 2500);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.reader.close();
  }
}
