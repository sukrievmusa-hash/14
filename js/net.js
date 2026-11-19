// Онлайн без своего сервера: игроки соединяются напрямую (WebRTC, библиотека Trystero).
// Знакомство идёт через бесплатные публичные реле Nostr, сами данные игры летят напрямую между игроками.
const APP_ID = 'sukrievmusa-dino-arena-v1';
const LIBS = ['https://esm.run/trystero@0.27.0', 'https://esm.sh/trystero@0.27.0'];

export async function connect(roomName, h) {
  let lib = null;
  for (const url of LIBS) {
    try { lib = await import(url); if (lib && lib.joinRoom) break; } catch (e) { console.warn('net lib', url, e); }
  }
  if (!lib || !lib.joinRoom) return null;

  const room = lib.joinRoom({ appId: APP_ID, identity: 'none' }, 'dino-' + roomName);
  const st = room.makeAction('st'), hit = room.makeAction('hit'), kill = room.makeAction('kill');
  st.onMessage((d, ctx) => h.onState(d, ctx.peerId));
  hit.onMessage((d, ctx) => h.onHit(d, ctx.peerId));
  kill.onMessage((d, ctx) => h.onKill(d, ctx.peerId));
  room.onPeerLeave(({ peerId }) => h.onLeave && h.onLeave(peerId));
  if (room.onError) room.onError(e => console.warn('room error', e));

  const safe = fn => { try { const p = fn(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* нет соединения */ } };
  return {
    room: roomName,
    state: d => safe(() => st.send(d)),
    hit: (peer, d) => safe(() => hit.send(d, { target: peer })),
    kill: d => safe(() => kill.send(d)),
    leave: () => safe(() => room.leave()),
  };
}
