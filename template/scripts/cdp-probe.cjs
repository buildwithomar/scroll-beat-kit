// Read numbers — or grab a screenshot — straight out of a running Chromium.
//
// Granular is Electron and runs Chromium with --remote-debugging-port=9222, so
// the preview panel is reachable over the DevTools protocol. That makes this
// the one probe that measures the engine that actually shows the bug — no
// harness iframe, no virtual time, real viewport, real DPR.
//
// The preview is not its own target: it is a frame inside Granular's window.
// So the probe attaches to the window, walks its frame tree, finds the frame
// whose URL matches, and evaluates inside it via an isolated world.
//
//   node _qa/cdp-probe.cjs                    # list targets/frames, dump the seatdbg overlay
//   node _qa/cdp-probe.cjs index.html "1+1"   # evaluate any expression in that frame
//
//   CDP_PORT=9333      point it at any other Chromium started with --remote-debugging-port
//   CDP_SHOT=/tmp/x.png  after evaluating, wait CDP_WAIT ms (default 500) and save a PNG;
//   CDP_CLIP_SEL='.dk-flow'  clip it to that element's box plus CDP_PAD px (default 16)
//
// Needs Node 22+ (global WebSocket). Nothing here ships; index.html never
// references it.
const http = require('http');
const fs = require('fs');

function getJSON(url){
  return new Promise((res, rej) => http.get(url, r => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => { try { res(JSON.parse(d)); } catch(e){ rej(e); } });
  }).on('error', rej));
}

(async () => {
  const want = process.argv[2] || 'index.html';
  const port = process.env.CDP_PORT || '9222';
  const ver = await getJSON('http://localhost:' + port + '/json/version');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, {res, rej});
    ws.send(JSON.stringify(sessionId ? {id:i, method, params, sessionId} : {id:i, method, params}));
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if(m.id && pending.has(m.id)){
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  const { targetInfos } = await send('Target.getTargets');
  for (const t of targetInfos)
    console.log('target  ', t.type.padEnd(8), (t.title || '').slice(0, 30).padEnd(32), t.url.slice(0, 110));

  let sessionId = null, contextId = null;
  const own = targetInfos.find(t => t.url.includes(want));
  if(own){
    sessionId = (await send('Target.attachToTarget', { targetId: own.targetId, flatten: true })).sessionId;
  } else {
    for(const pt of targetInfos.filter(x => x.type === 'page')){
      const s = (await send('Target.attachToTarget', { targetId: pt.targetId, flatten: true })).sessionId;
      const { frameTree } = await send('Page.getFrameTree', {}, s);
      const frames = []; (function walk(n){ frames.push(n.frame); (n.childFrames || []).forEach(walk); })(frameTree);
      for(const fr of frames) console.log('frame   ', (fr.name || '-').slice(0, 20).padEnd(22), fr.url.slice(0, 120));
      const fr = frames.find(f => f.url.includes(want));
      if(fr){
        sessionId = s;
        contextId = (await send('Page.createIsolatedWorld', { frameId: fr.id, grantUniveralAccess: true }, s)).executionContextId;
        break;
      }
      await send('Target.detachFromTarget', { sessionId: s });
    }
  }
  if(!sessionId){
    console.log('preview page not found as a target or as a frame — is the preview panel open?');
    ws.close(); return;
  }

  // CDP_VIEWPORT=390x844 (and optional CDP_DPR=3) emulates a viewport of that size on the
  // attached page — the way to test phone widths, since --headless=new refuses windows
  // under ~500px. The override sticks for later probes until CDP_VIEWPORT=clear.
  if(process.env.CDP_VIEWPORT){
    if(process.env.CDP_VIEWPORT === 'clear'){
      await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
      console.log('viewport override cleared');
    } else {
      const [w, h] = process.env.CDP_VIEWPORT.split('x').map(Number);
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: +(process.env.CDP_DPR || 2), mobile: w < 700 }, sessionId);
      await new Promise(res => setTimeout(res, 250));
      console.log('viewport emulated ' + w + 'x' + h);
    }
  }

  const evalIn = async (expression) => {
    const params = { expression, returnByValue: true, awaitPromise: true };   // async expressions resolve before printing
    if(contextId) params.contextId = contextId;
    return send('Runtime.evaluate', params, sessionId);
  };

  const expr = process.argv[3] || `(() => {
    const pre = [...document.querySelectorAll('pre')].find(p => p.style.zIndex === '2147483647');
    return pre ? pre.textContent : 'no seatdbg overlay on this page (is ?seatdbg=1 in the URL?)';
  })()`;
  const r = await evalIn(expr);
  console.log('---');
  console.log(r.exceptionDetails ? 'EXCEPTION: ' + JSON.stringify(r.exceptionDetails).slice(0, 400) : r.result.value);

  // CDP_FONTS_SEL='.hero h1,.ag-say' — for each selector, print the PLATFORM fonts that
  // actually rendered the element's text (family, glyph count, custom or system). This is
  // the truth about fonts: computed font-family only says what was asked for.
  if(process.env.CDP_FONTS_SEL){
    await send('DOM.enable', {}, sessionId); await send('CSS.enable', {}, sessionId);
    const { root } = await send('DOM.getDocument', { depth: 0 }, sessionId);
    for(const sel of process.env.CDP_FONTS_SEL.split(',')){
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel.trim() }, sessionId);
      if(!nodeId){ console.log('fonts  ' + sel.trim() + ': no such element'); continue; }
      const { fonts } = await send('CSS.getPlatformFontsForNode', { nodeId }, sessionId);
      console.log('fonts  ' + sel.trim() + ': ' + fonts.map(f => f.familyName + ' x' + f.glyphCount + (f.isCustomFont ? ' (webfont)' : ' (system)')).join(', '));
    }
  }

  if(process.env.CDP_SHOT){
    await new Promise(res => setTimeout(res, +(process.env.CDP_WAIT || 500)));
    let clip = null;
    if(process.env.CDP_CLIP_SEL){
      // clip is in PAGE coordinates, so the scroll offset is added to the viewport rect —
      // without it a capture of a scrolled-to element silently returns the top of the page
      const q = await evalIn(`(() => { const el = document.querySelector(${JSON.stringify(process.env.CDP_CLIP_SEL)});
        if(!el) return null; const b = el.getBoundingClientRect(); return {x:b.left + scrollX, y:b.top + scrollY, w:b.width, h:b.height}; })()`);
      const b = q.result.value;
      if(b){
        const pad = +(process.env.CDP_PAD || 16);
        clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + 2 * pad, height: b.h + 2 * pad, scale: +(process.env.CDP_SCALE || 1) };
      } else console.log('clip selector matched nothing; capturing the viewport');
    }
    const shot = await send('Page.captureScreenshot', Object.assign({ format: 'png' }, clip ? { clip } : {}), sessionId);
    fs.writeFileSync(process.env.CDP_SHOT, Buffer.from(shot.data, 'base64'));
    console.log('screenshot -> ' + process.env.CDP_SHOT + (clip ? '  clip ' + JSON.stringify(clip) : ''));
  }
  ws.close();
})().catch(e => { console.error('cdp-probe failed:', e.message); process.exit(1); });
