import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { SpiderBlockSettings: Settings } = load('shared/settings.js');

test('site list matches the site and its subdomains', () => {
  const list = ['example.com', 'https://www.news.org/page'];
  assert.ok(Settings.siteListed(list, 'example.com'));
  assert.ok(Settings.siteListed(list, 'www.example.com'));
  assert.ok(Settings.siteListed(list, 'blog.example.com'));
  assert.ok(Settings.siteListed(list, 'news.org'));
  assert.ok(!Settings.siteListed(list, 'notexample.com'));
  assert.ok(!Settings.siteListed(list, 'example.com.evil.net'));
  assert.ok(!Settings.siteListed(list, ''));
});

test('status explains why protection is on or off', () => {
  const base = Settings.normalize({});
  const now = 1_000_000;
  assert.equal(Settings.status(base, 'a.com', now), 'on');
  assert.equal(Settings.status({ ...base, enabled: false }, 'a.com', now), 'off');
  assert.equal(Settings.status({ ...base, pausedUntil: now + 1 }, 'a.com', now), 'paused');
  assert.equal(Settings.status({ ...base, pausedUntil: now - 1 }, 'a.com', now), 'on');
  assert.equal(Settings.status({ ...base, disabledSites: ['a.com'] }, 'www.a.com', now), 'site');
});

test('stored values of the wrong type fall back to defaults', () => {
  const s = Settings.normalize({ useAI: 'yes', style: 'scene', sensitivity: 'extreme', disabledSites: 'x' });
  assert.equal(s.useAI, true);
  assert.equal(s.style, 'scene');
  assert.equal(s.sensitivity, 'balanced');
  assert.deepEqual([...s.disabledSites], []);
});

test('every sensitivity level is complete', () => {
  for (const level of Object.values(Settings.SENSITIVITY)) {
    assert.ok(['center', 'adaptive', 'five'].includes(level.crops));
    for (const key of ['spider', 'web', 'arachnid']) assert.ok(level[key] > 0 && level[key] < 1);
    assert.ok(level.pageMentions >= 1 && level.pageDensity > 0);
  }
});
