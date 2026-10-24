import test from 'node:test';
import assert from 'node:assert/strict';
import { McpClient, payload } from '../scripts/mcp-client.mjs';
const fixture = `
 const rl=require('node:readline').createInterface({input:process.stdin});
 rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
 let result;if(m.method==='initialize')result={serverInfo:{name:'mock',version:'1'}};
 else if(m.method==='tools/list')result={tools:[{name:'read'},{name:'hang'}]};
 else if(m.params.name==='hang')return;
 else result={content:[{type:'text',text:JSON.stringify({value:m.params.arguments.value})}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
 });`;
test('standard stdio initialize/list/call roundtrip',async()=>{
 const client=new McpClient('',{args:['-e',fixture],timeoutMs:2000});
 try {await client.start();assert.equal(client.tools.length,2);assert.deepEqual(await client.call('read',{value:'μ and θ'}),{value:'μ and θ'});}
 finally {await client.close();}
});
test('unknown outcome poisons session, so a timeout is never retried',async()=>{
 const client=new McpClient('',{args:['-e',fixture],timeoutMs:150});
 try {await client.start();await assert.rejects(client.call('hang'),/timeout/);assert.equal(client.unknownOutcome,true);await assert.rejects(client.call('read'),/unusable/);}
 finally {await client.close();}
});
test('both MCP and JSX error responses are failures',()=>{
 assert.throws(()=>payload({isError:true,content:[{type:'text',text:'error'}]}));
 assert.throws(()=>payload({content:[{type:'text',text:'{"success":false,"message":"failed"}'}]}));
});
