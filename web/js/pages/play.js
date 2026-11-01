// Full-screen play page: mic check first, then the game.
import { api, auth, esc, el, guestName } from '../api.js';
import { go } from '../app.js';
import { Session } from '../play/session.js';

export async function playPage(root, id, params) {
  const { game } = await api('/games/' + id);
  document.body.classList.add('playing');
  document.title = `${game.title} — Shiver`;
  const page = el(`<div class="play">
    <div class="bar hidden"><span class="code" title="Copy invite link"></span><button class="btn small" data-a="rec" title="Record a video of your game">● Rec</button><button class="btn small" data-a="mute">🎙 Mute</button><button class="btn small" data-a="full">⛶</button><button class="btn small" data-a="leave">Leave</button></div>
    <div class="prejoin"><div class="box">
      <h2>${esc(game.title)}</h2>
      <p>Wear headphones. In Shiver <b>your microphone makes noise inside the game</b>, so monsters can hear you talk.</p>
      ${auth.user ? '' : `<input id="name" maxlength="20" value="${esc(guestName())}" placeholder="Your name">`}
      <div class="opts">
        <button class="btn red big" id="withmic">🎙 Enable mic &amp; play</button>
        <button class="btn" id="nomic">Play without mic (text chat only)</button>
        <button class="btn ghost" id="back">Back</button>
      </div>
      <div class="err"></div>
    </div></div>
  </div>`);
  root.appendChild(page);
  let session = null;
  const bar = page.querySelector('.bar');
  const err = page.querySelector('.err');

  const leave = () => go('/game/' + id);
  page.querySelector('#back').onclick = leave;

  const start = (mic) => {
    const nameInput = page.querySelector('#name');
    if (nameInput) localStorage.setItem('shiver.guest', nameInput.value.trim() || guestName());
    page.querySelector('.prejoin').remove();
    bar.classList.remove('hidden');
    session = new Session({
      container: page, gameId: id, code: params.get('code') || undefined, isPrivate: params.get('private') === '1', mic,
      name: auth.user ? auth.user.name : guestName(),
      onWelcome: (m) => {
        const c = bar.querySelector('.code');
        c.textContent = `ROOM ${m.code} · copy invite`;
        c.onclick = () => { navigator.clipboard?.writeText(`${location.origin}/play/${id}?code=${m.code}`); c.textContent = 'Invite link copied!'; setTimeout(() => (c.textContent = `ROOM ${m.code} · copy invite`), 1500); };
        history.replaceState(null, '', `/play/${id}?code=${m.code}`);
      },
      onMute: (m) => (bar.querySelector('[data-a=mute]').textContent = m ? '🔇 Unmute' : '🎙 Mute'),
      onRecording: (on) => { const b = bar.querySelector('[data-a=rec]'); b.textContent = on ? '■ Stop' : '● Rec'; b.classList.toggle('red', on); },
      onLeave: leave,
      onError: (e) => {
        if (!session) return;
        page.appendChild(el(`<div class="prejoin"><div class="box"><h2>Lost in the dark</h2><p>${esc(e)}</p><div class="opts"><button class="btn red" onclick="location.reload()">Try again</button><a class="btn ghost" href="/game/${id}" data-link>Back</a></div></div></div>`));
        session.destroy();
        session = null;
      },
    });
    if (!mic) bar.querySelector('[data-a=mute]').remove();
  };

  // live mic preview before joining
  let preview = null;
  page.querySelector('#withmic').onclick = async () => {
    try {
      if (!preview) {
        preview = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
        preview.getTracks().forEach((t) => t.stop());
      }
      start(true);
    } catch (e) {
      err.textContent = 'Microphone blocked: ' + e.message + '. You can still play without it.';
    }
  };
  page.querySelector('#nomic').onclick = () => start(false);
  bar.onclick = (e) => {
    const a = e.target.dataset.a;
    if (a === 'leave') leave();
    if (a === 'mute') session?.toggleMute();
    if (a === 'rec') session?.record();
    if (a === 'full') document.fullscreenElement ? document.exitFullscreen() : page.requestFullscreen();
  };
  return () => { session?.destroy(); document.body.classList.remove('playing'); document.title = 'Shiver'; };
}
