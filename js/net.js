// Онлайн без своего сервера (ЭРА ЯЩЕРОВ): игроки соединяются напрямую (WebRTC, библиотека Trystero).
// Знакомство идёт через бесплатные публичные реле Nostr, сами данные игры летят напрямую между игроками.
const APP_ID = 'sukrievmusa-era-yasherov-v1';
const LIBS = ['https://esm.run/trystero@0.27.0', 'https://esm.sh/trystero@0.27.0'];

export async function connect(roomName, h) {
  let lib = null;
  for (const url of LIBS) {
    try { lib = await import(url); if (lib && lib.joinRoom) break; } catch (e) { console.warn('net lib', url, e); }
  }
  if (!lib || !lib.joinRoom) return null;

  const room = lib.joinRoom({ appId: APP_ID, identity: 'none' }, 'era-' + roomName);
  const st = room.makeAction('st'), hit = room.makeAction('hit'), kill = room.makeAction('kill'), call = room.makeAction('call');
  st.onMessage((d, ctx) => h.onState(d, ctx.peerId));
  hit.onMessage((d, ctx) => h.onHit(d, ctx.peerId));
  kill.onMessage((d, ctx) => h.onKill(d, ctx.peerId));
  call.onMessage((d, ctx) => h.onCall && h.onCall(d, ctx.peerId));
  room.onPeerLeave(({ peerId }) => h.onLeave && h.onLeave(peerId));
  if (room.onPeerJoin) room.onPeerJoin(({ peerId }) => h.onJoin && h.onJoin(peerId));
  // игрок нашёлся через сервер знакомств, но сеть не пустила прямое соединение
  if (room.onError) room.onError(e => { console.warn('room error', e); if (e && e.code === 'peer-connect-failed') h.onConnFail && h.onConnFail(e.peerId); });

  const safe = fn => { try { const p = fn(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* нет соединения */ } };
  return {
    room: roomName,
    state: d => safe(() => st.send(d)),
    hit: (peer, d) => safe(() => hit.send(d, { target: peer })),
    kill: d => safe(() => kill.send(d)),
    call: d => safe(() => call.send(d)),
    leave: () => safe(() => room.leave()),
    // сколько серверов знакомств (Nostr-реле) сейчас на связи
    relays: () => {
      try { const r = lib.getRelaySockets ? Object.values(lib.getRelaySockets()) : []; return [r.filter(w => w.readyState === 1).length, r.length]; } catch (e) { return [0, 0]; }
    },
  };
}
