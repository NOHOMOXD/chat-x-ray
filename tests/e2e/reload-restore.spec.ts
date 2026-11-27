import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures.ts';

/**
 * A page reload is the most common interruption on Twitch (F5, an update, a
 * crashed renderer). Before the live snapshot, the extension came back with an
 * empty observation: the warm-up and the viewer estimate started from zero.
 * This test proves the reload resumes the running broadcast.
 */

interface SessionExport {
  observation: { chat: Array<[number, number]> };
  current: { stats: { observedChatters: number; sessionMs: number } };
  broadcast?: { id?: string } | null;
}

const CHANNEL = 'testchannel';
const VIEWER = '[data-a-target="animated-channel-viewers-count"]';

function privmsg({ id, login, userId, text }: { id: string; login: string; userId: string; text: string }) {
  return (
    `@badge-info=;badges=;color=;display-name=${login};first-msg=0;id=${id};` +
    `mod=0;room-id=1;tmi-sent-ts=${Date.now()};user-id=${userId};user-type= ` +
    `:${login}!${login}@${login}.tmi.twitch.tv PRIVMSG #${CHANNEL} :${text}`
  );
}

test('resumes the same broadcast after a page reload instead of warming up again', async ({ page }) => {
  test.setTimeout(240000);
  const counter = page.locator(VIEWER + ' + [data-tcx-ui="real-viewers"]');

  const openRoom = () => page.evaluate(async () => {
    const socket = window.__fixture.createChatSocket();
    if (!socket) throw new Error('Missing chat socket');
    const closed = new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
    socket.close();
    await closed;
    window.roomSocket = socket;
    socket.dispatchEvent(new Event('open'));
  });
  // Exercise the production fetch observer and the common batched GQL
  // response. Neither test page supplies a stream ID in its DOM.
  await page.route('https://gql.twitch.tv/gql', route => route.fulfill({
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([{ data: { user: { login: CHANNEL, stream: { id: '123450001' } } } }]),
  }));
  const identify = () => page.evaluate(() => fetch('https://gql.twitch.tv/gql', {
    method: 'POST', body: JSON.stringify([{ variables: { channelLogin: 'testchannel' } }]),
  }).then(r => r.json()));
  const send = (frame: string) => page.evaluate(
    (line) => window.__fixture.deliver(window.roomSocket, line), frame);
  const exportSnapshot = async () => {
    const download = page.waitForEvent('download');
    await page.locator('[data-tcx-session-export="0"]').click();
    const path = await (await download).path();
    if (!path) throw new Error('Missing download path');
    return JSON.parse(await readFile(path, 'utf8')) as SessionExport;
  };
  const openSettings = async () => {
    await page.locator('[data-tcx-ui="settings-button"]').click();
    await page.locator('[data-tcx-setting="recordSession"]').check();
  };

  await openRoom();
  await identify();
  await openSettings();
  await page.keyboard.press('Escape');
  for (let index = 0; index < 6; index += 1) {
    await send(privmsg({
      id: 'warm' + index, login: 'writer' + index,
      userId: String(12000 + index * 2000), text: 'message ' + index,
    }));
  }

  // The first (provisional) estimate after one minute of continuous chat.
  await expect(counter).toContainText('≈', { timeout: 130000 });
  await openSettings();
  const before = await exportSnapshot();
  await page.keyboard.press('Escape');
  expect(before.observation.chat.length).toBeGreaterThan(0);
  const firstInterval = before.observation.chat[0];
  if (!firstInterval) throw new Error('Missing observation interval');
  const beforeStart = firstInterval[0];

  const reloadedAt = Date.now();
  await page.reload();
  await openRoom();

  await expect(counter).toContainText('(6)', { timeout: 15000 });
  await expect(counter).not.toContainText('≈');
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('tcx:')))).toEqual([]);
  await identify();

  await expect(counter).toContainText('≈', { timeout: 30000 });
  await expect(counter).not.toContainText('Последняя оценка');
  await send(privmsg({ id: 'after-reload', login: 'newchatter', userId: '85321', text: 'one more writer' }));
  await counter.hover();
  const popover = page.locator('[role="dialog"][data-state="visible"] .tcx-tip--viewer');
  await expect(popover).not.toContainText('Последняя оценка');
  await expect(popover).toContainText('Наблюдаем');
  // A restored estimate must not look like a window that just started over.
  await expect(popover).not.toContainText('собрано 0');
  await counter.press('Escape');
  await openSettings();
  let after: SessionExport | undefined;
  await expect.poll(async () => {
    after = await exportSnapshot();
    return after.observation.chat.length;
  }).toBeGreaterThanOrEqual(2);

  if (!after) throw new Error('Missing exported snapshot');
  expect(after.current.stats.observedChatters).toBe(7);
  expect(after.current.stats.sessionMs).toBeGreaterThanOrEqual(60000);
  expect(after.observation.chat.length).toBeGreaterThanOrEqual(2);
  expect(after.broadcast?.id).toBe('123450001');
  // The observation continues from the pre-reload start, not from the reload.
  expect(after.observation.chat[0]?.[0]).toBe(beforeStart);
  expect(after.observation.chat.at(-1)?.[1]).toBeGreaterThanOrEqual(reloadedAt);
  const covered = after.observation.chat.reduce(
    (total, [start, end]) => total + (end - start), 0);
  expect(covered).toBeGreaterThan(60000);
  await page.keyboard.press('Escape');
});
