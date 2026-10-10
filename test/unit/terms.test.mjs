import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { SpiderBlockTerms: Terms } = load('shared/terms.js');
const matcher = Terms.createMatcher();
const hit = (text, m = matcher) => m.find(text)?.term ?? null;

test('finds spider words in many languages and scripts', () => {
  const cases = [
    'A huge spider in my bath',
    'Spiders!',
    'tarantulas for sale',
    'black widow bite symptoms',
    'Found a huntsman behind the curtain',
    'daddy-long-legs in the corner',
    'Latrodectus hesperus',
    'una araña enorme',
    'aranha-armadeira',
    "une araignée au plafond",
    'Hausspinne im Keller',
    'Vogelspinnen-Terrarium',
    'ragno violino',
    'pająk krzyżak',
    'паук в ванной',
    'павук',
    'αράχνη',
    'örümcek',
    'hämähäkki',
    'nhện nhà',
    'laba-laba',
    'עכביש',
    'العنكبوت',
    'मकड़ी',
    '蜘蛛の巣',
    'クモが出た',
    'アシダカグモ',
    '巨大蜘蛛',
    '거미',
    'แมงมุม',
  ];
  for (const text of cases) assert.ok(hit(text), text);
});

test('reads file names and camelCase', () => {
  assert.ok(hit(Terms.textFromUrl('https://cdn.example.com/2024/05/wolf_spider-closeup.jpg?w=600')));
  assert.ok(hit(Terms.textFromUrl('https://example.com/img/BlackWidowSpider.png')));
  assert.ok(hit('IMG_spider01.jpg'));
  assert.ok(hit(Terms.textFromUrl('https://example.com/a%20tarantula%20photo.jpg')));
});

test('ignores the host name of image URLs', () => {
  assert.equal(hit(Terms.textFromUrl('https://spidersweb.example/img/phone-review.jpg')), null);
});

test('does not hide things that only share a word', () => {
  const cases = [
    'Spider-Man: No Way Home',
    'Spiderman costume',
    'Into the Spider-Verse',
    'spider plant care guide',
    'Spider lily in bloom',
    'spider veins treatment',
    'Spider solitaire',
    'Fiat 124 Spider review',
    'McLaren 720S Spider',
    'SpiderManPoster.jpg',
    'Alfa Romeo Spider',
    'how a search engine spider crawls your site',
    'Black Widow (2021) Marvel poster',
    "The Huntsman: Winter's War film",
    'Spinnerei Leipzig',
    'spindle',
    'スモークモード',
    'ビッグモーター',
    'Scorpions band in concert',
    'tick the box',
    'a cosy cabin',
  ];
  for (const text of cases) assert.equal(hit(text), null, text);
});

test('a spider next to an allowed phrase is still found', () => {
  assert.ok(hit('Spider-Man fights a giant spider'));
  assert.ok(hit('my spider plant has a spider on it'));
});

test('allowed phrases end at word boundaries', () => {
  assert.ok(hit('spider mansion tour'));
});

test('Spider-Man can be hidden too', () => {
  const strict = Terms.createMatcher({ allowSpiderMan: false });
  assert.ok(hit('Spider-Man swinging', strict));
});

test('webs and other arachnids are opt-in', () => {
  assert.equal(hit('cobwebs everywhere'), null);
  assert.equal(hit('scorpion sting'), null);
  const all = Terms.createMatcher({ webs: true, arachnids: true });
  assert.equal(all.find('cobwebs everywhere')?.category, 'webs');
  assert.equal(all.find('Spinnennetz am Fenster')?.category, 'webs');
  assert.equal(all.find('scorpion sting')?.category, 'arachnids');
  assert.equal(all.find('deer tick on a dog')?.category, 'arachnids');
  assert.equal(all.find('Mortal Kombat Scorpion'), null);
});

test('custom words', () => {
  const custom = Terms.createMatcher({ extraBlock: ['creepy crawly', 'クモ類'], extraAllow: ['spider tank'] });
  assert.ok(hit('a creepy crawly', custom));
  assert.ok(hit('creepy crawlys', custom));
  assert.ok(hit('このクモ類は', custom));
  assert.equal(hit('the spider tank in the game', custom), null);
});

test('counts mentions and reports their positions', () => {
  assert.equal(matcher.count('spider spider spiders tarantula. Spider-Man'), 4);
  assert.equal(matcher.count('spider spider spider spider', 2), 2);
  const text = 'We saw Spider-Man, then a huge spider and two tarantulas.';
  const words = [...matcher.spans(text)].map((s) => text.substr(s.index, s.length));
  assert.deepEqual(words, ['spider', 'tarantulas']);
});

test('stays fast on long text without spaces', () => {
  // A regression guard: an earlier pattern layout took ~330 ms here.
  const all = Terms.createMatcher({ webs: true, arachnids: true });
  all.find('warm up');
  const text = '今日はいい天気です。東京の天気は晴れのち曇り'.repeat(1000);
  const started = performance.now();
  all.count(text);
  assert.ok(performance.now() - started < 150, `took ${Math.round(performance.now() - started)} ms`);
});
