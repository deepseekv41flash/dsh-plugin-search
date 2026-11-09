// Probe the DSH experimental cross-realm inspector (host realm) over CDP.
// Usage: node tools/probe-host-realm.mjs "<expression>"
const [, , expression] = process.argv
const list = await (await fetch('http://127.0.0.1:9230/json/list')).json()
const wsUrl = list[0]?.webSocketDebuggerUrl
if (!wsUrl) { console.error('no inspector target'); process.exit(1) }
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve)
  ws.addEventListener('error', reject)
})
await send('Runtime.enable')
const result = await send('Runtime.evaluate', {
  expression: expression ?? '1+1',
  returnByValue: true,
  awaitPromise: true,
})
console.log(JSON.stringify(result.result ?? result, null, 2))
ws.close()
