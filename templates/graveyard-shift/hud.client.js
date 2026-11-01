// GRAVEYARD SHIFT — HUD and night sounds.
audio.loop('wind', { volume: 0.4 });
game.state.watch('lit', (n) => ui.objective(`Light the grave candles (${n}/6). Hold E.`));
game.state.watch('timeLeft', (t) => ui.text('clock', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} until midnight`, { x: 50, y: 5, size: 15, color: t < 60 ? '#ff5050' : '#c8c0a8' }));
every(11, () => { if (rand() < 0.5) audio.play('whisper', { volume: 0.3 }); });
on('begin', () => ui.subtitle('Move with WASD, aim with the mouse. Quiet feet live longer.', 5));
