// Words that suggest an image shows a spider, in many languages.
//
// Term syntax:
//   "word"    whole word only
//   "word*"   word start: "spider*" also matches "spiders", "spiderling"
//   "*word"   word end: "*spinne" also matches the German "Hausspinne"
//   "~word"   anywhere, for scripts written without spaces (蜘蛛, แมงมุม)
//   A space inside a term matches spaces, hyphens, underscores, dots or nothing,
//   so "black widow" also matches "black-widow" and "BlackWidow".
// Objects can add `unless`: the match is ignored when the surrounding text also
// matches that pattern (e.g. "Black Widow" next to "Marvel").
(function (root) {
  'use strict';

  const MARVEL = /marvel|avenger|natasha|romanoff|scarlett|johansson|yelena|\bmcu\b|disney|cosplay|comic|superhero|movie|film|trailer|lego|funko/i;
  const KATAKANA = '\\u30A0-\\u30FF';

  const CATEGORIES = {
    spiders: [
      // English
      'spider*', 'arachnid*', 'arachnophob*', 'tarantula*', 'araneae', 'araneid*', 'araneomorph*', 'mygalomorph*',
      'theraphosid*', 'salticid*', 'lycosid*', 'sparassid*', 'theridiid*', 'thomisid*', 'pholcid*', 'agelenid*',
      'opiliones', 'harvestman', 'harvestmen', 'daddy long legs', 'daddy longlegs', 'solifug*', 'goliath bird*',
      'brown recluse*', 'funnel web*', 'funnelweb*', 'orb weaver*', 'orbweaver*', 'incy wincy',
      { t: 'black widow*', unless: MARVEL },
      { t: 'huntsman', unless: /kingsman|film|movie|snow white|hemsworth|corporation|chemical|hotel|tailor|savile|knife|rifle|shooting|whisk/i },
      { t: 'redback*', unless: /boot|shoe|footwear|network|workwear|safety/i },
      // Scientific names of common genera
      'latrodectus', 'loxosceles', 'phidippus', 'heteropoda', 'argiope', 'nephila', 'trichonephila', 'atrax',
      'hadronyche', 'phoneutria', 'pholcus', 'tegenaria', 'eratigena', 'steatoda', 'parasteatoda', 'araneus', 'lycosa',
      'hogna', 'poecilotheria', 'brachypelma', 'grammostola', 'theraphosa', 'salticus', 'maratus', 'misumena',
      'dolomedes', 'cupiennius', 'segestria', 'zoropsis', 'cheiracanthium', 'larinioides', 'gasteracantha',
      'micrathena', 'dysdera', 'scytodes', 'agelena', 'pisaura',
      // Spanish, Portuguese
      'araña', 'arañas', 'arañita*', 'arácnido*', 'aracnido*', 'tarántula*', 'migala*', 'aranh*', 'aracnídeo*',
      'tarântula*', 'caranguejeira*',
      { t: 'viuda negra', unless: MARVEL }, { t: 'viúva negra', unless: MARVEL },
      // French
      'araignée*', 'araignee*', 'arachnide*', 'tarentule*', 'mygale*', 'faucheux',
      { t: 'veuve noire', unless: MARVEL },
      // German, Dutch
      '*spinne', '*spinnen', 'spinnentier*', 'tarantel*', 'weberknecht*', 'vogelspin*', 'huisspin*', 'wolfspin*',
      'kruisspin*', 'spinnetje*', { t: 'schwarze witwe', unless: MARVEL },
      // Italian
      'ragno', 'ragni', 'ragnetto', 'ragnetti', 'ragnone', 'aracnid*', 'tarantola', 'tarantole',
      { t: 'vedova nera', unless: MARVEL },
      // Nordic, Baltic, Finnish, Hungarian, Romanian, Turkish
      'spindel*', 'spindlar*', 'edderkop*', 'hämähäk*', 'ämblik*', 'zirnekl*', 'voras', 'vorai', 'pók', 'pókok',
      'păianjen*', 'paianjen*', 'örümcek*',
      // Polish, Czech, Slovak, South Slavic, Slovenian
      'pająk*', 'pajęczak*', 'ptasznik*', 'pavouk*', 'pavouc*', 'pavúk*', 'pavúc*', 'pauk', 'pauci', 'pauka',
      'paukov*', 'pajek', 'pajki', { t: 'czarna wdowa', unless: MARVEL },
      // Greek, Cyrillic
      'αράχν*', 'αραχν*', 'ταραντούλ*', 'паук*', 'паучк*', 'паучок*', 'паучих*', 'паучь*', 'паучий', 'тарантул*',
      'каракурт*', 'павук*', 'павуч*', 'паяк*',
      { t: 'черная вдова', unless: MARVEL }, { t: 'чёрная вдова', unless: MARVEL },
      // Southeast Asian, African
      'nhện', 'laba laba', 'labah labah', 'gagamba', 'buibui', 'spinnekop*',
      // Scripts without spaces between words
      '~עכביש', '~عنكبوت', '~عناكب', '~عنکبوت', '~مکڑی', '~मकड़ी', '~मकडी', '~মাকড়সা', '~சிலந்தி', '~แมงมุม',
      '~ობობა', '~蜘蛛', '~狼蛛', '~跳蛛', '~捕鸟蛛', '~捕鳥蛛', '~毒蛛', '~タランチュラ', '~거미', '~타란툴라',
      // Japanese katakana: クモ on its own (not inside words like スモークモード), and グモ ending a species name
      { re: `(?<![${KATAKANA}])クモ(?![${KATAKANA}])` },
      { re: `(?<=[${KATAKANA}])グモ(?![${KATAKANA}])` },
    ],

    webs: [
      'cobweb*', 'telaraña*', 'telarana*', '*spinnennetz*', 'spinnweb*', 'spinnenweb*', 'ragnatel*', 'pajęczyn*',
      'pavučin*', 'паутин*', 'павутин*', '~蛛网', '~蛛網',
    ],

    arachnids: [
      { t: 'scorpion*', unless: /kombat|mortal|ninja|band|klaus|meine|wind of change|album|concert|tour|king|kick|bowl|tv series|cbs|ryzen|motorcycle|exhaust|helmet/i },
      'escorpi*', 'skorpion*', 'скорпион*', 'скорпіон*', 'akrep*', '~蝎子', '~蠍子', '~サソリ', '~전갈',
      'whip scorpion*', 'vinegaroon*', 'amblypyg*', 'pseudoscorpion*', 'uropygi*', 'wind scorpion*',
      // ticks and mites ("tick" alone is too common a word)
      'deer tick*', 'dog tick*', 'lone star tick*', 'tick bite*', 'tick borne', 'ticks on', 'ixodes', 'ixodid*',
      'garrapata*', 'carrapato*', '*zecke', '*zecken', 'zecca', 'zecche', 'tique*', 'kleszcz*', 'клещ*', 'кліщ*',
      'fästing*', 'flått*', 'punkki*', '~蜱', '~진드기', { re: `(?<![${KATAKANA}])ダニ(?![${KATAKANA}])` },
      'dust mite*', 'mite infest*', 'varroa', 'chigger*', 'scabies mite*',
    ],
  };

  // Phrases that contain a spider word but are not about spiders. They are blanked
  // out before matching, so "Spider-Man fights a giant spider" still matches.
  const SPIDER_MAN = [
    'spider[\\s\\-_.]*(?:m[ae]n|wom[ae]n|girls?|boys?|verse|gwen|punk|ham|noir|sense)',
    'spidey',
    '(?:homem|hombre|mujer)[\\s\\-]*ara(?:ñ|n|nh)a',
    "l['’\\s]*homme[\\s\\-]*araign[ée]e",
    'uomo[\\s\\-]*ragno',
    'człowiek[\\s\\-]*pająk',
    'человек[\\s\\-]*паук',
    'людина[\\s\\-]*павук',
    'örümcek[\\s\\-]*adam',
    'スパイダーマン',
    '蜘蛛[侠俠人]',
    '스파이더맨',
  ];

  const NOT_SPIDERS = [
    'spider[\\s\\-_.]*(?:plants?|lil(?:y|ies)|mums?|chrysanthemums?|flowers?|ferns?|charts?|diagrams?|graphs?|plots?|solitaire|veins?|angiomas?|n(?:a)?evus|monkeys?|cams?|oak|gears?|couplings?|fittings?)',
    'spidercam',
    '(?:web|search[\\s\\-]*engine|seo|crawler|scrapy)[\\s\\-_]*spiders?',
    // Convertible cars: "Alfa Romeo Spider", "Fiat 124 Spider", "McLaren 720S Spider"
    '(?:alfa[\\s\\-]*romeo|fiat|abarth|ferrari|mclaren|maserati|lamborghini|porsche|audi|lotus|mazda|triumph)(?:[\\s\\-]+[a-z]*\\d[\\w\\-]*)?[\\s\\-]+spider',
  ];

  const LETTER = '\\p{L}\\p{M}';
  const NO_SPACE_SCRIPTS = /[֐-ۿऀ-෿฀-๿Ⴀ-ჿ぀-ヿ㐀-鿿가-힯]/;

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Returns { start, end, source }. start: the term must begin a word. end:
  // 'word' (must end a word), 'rest' (takes in the rest of the word, so the whole
  // word is reported) or 'any'.
  function compileTerm(term) {
    if (term.re) return { start: false, end: 'any', source: term.re };
    let s = term.t ?? term;
    let anywhere = false;
    let prefix = false;
    let suffix = false;
    if (s.startsWith('~')) {
      anywhere = true;
      s = s.slice(1);
    }
    if (s.startsWith('*')) {
      suffix = true;
      s = s.slice(1);
    }
    if (s.endsWith('*')) {
      prefix = true;
      s = s.slice(0, -1);
    }
    const source = s.trim().split(/\s+/).map(escapeRe).join('[\\s\\-_.]*');
    // A leading "*" only drops the word-start check: taking in the letters before
    // the term as well would make long runs of text without spaces (Chinese,
    // Japanese) very slow to search.
    return { start: !anywhere && !suffix, end: anywhere ? 'any' : prefix ? 'rest' : 'word', source };
  }

  // User-supplied words: plural-tolerant, or "anywhere" for scripts without spaces.
  function userTerm(word) {
    const w = String(word).trim();
    if (!w) return null;
    if (NO_SPACE_SCRIPTS.test(w)) return '~' + w.replace(/^[~*]+|\*+$/g, '');
    return w.replace(/^[~*]+|\*+$/g, '') + '*';
  }

  // One regex per category, one capture group per term (to know which matched).
  // Terms are grouped by their word-boundary rules, and each group checks the
  // boundaries once around a list of plain alternatives. Boundary checks inside
  // every alternative stop the regex engine from skipping ahead quickly, which
  // made long pages in Chinese or Japanese take a tenth of a second to search.
  function compileCategory(terms) {
    const compiled = terms.map((t) => {
      const term = typeof t === 'string' ? { t } : t;
      return { term, ...compileTerm(term) };
    });
    const START = `(?<![${LETTER}])`;
    const END = { word: `(?![${LETTER}])`, rest: `[${LETTER}]*`, any: '' };
    const order = [];
    const parts = [];
    for (const start of [true, false]) {
      for (const end of ['word', 'rest', 'any']) {
        const group = compiled.filter((c) => c.start === start && c.end === end);
        if (!group.length) continue;
        order.push(...group);
        parts.push(`${start ? START : ''}(?:${group.map((c) => `(${c.source})`).join('|')})${END[end]}`);
      }
    }
    return { list: order.map((c) => c.term), regex: new RegExp(parts.join('|'), 'giu') };
  }

  // Blanks out allowed phrases and splits camelCase file names so
  // "BlackWidowSpider.jpg" reads as words. Allowed phrases are removed both
  // before the split (it would turn "McLaren" into "Mc Laren") and after it
  // (to catch "SpiderManPoster.jpg").
  function prepare(text, allowRegex) {
    let s = String(text || '').normalize('NFKC').replace(allowRegex, ' ');
    s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2');
    return s.replace(allowRegex, ' ');
  }

  // Same, but keeps every character at its position (for marking words in page text).
  function prepareInPlace(text, allowRegex) {
    return String(text || '').replace(allowRegex, (m) => ' '.repeat(m.length));
  }

  // Readable words from an image URL: path and query, never the host name (a site
  // called "spidersweb.example" should not hide every image on it).
  function textFromUrl(url) {
    if (!url || typeof url !== 'string' || url.startsWith('data:') || url.startsWith('blob:')) return '';
    let path = url;
    try {
      const u = new URL(url, 'https://x.invalid/');
      path = u.pathname + ' ' + u.search;
    } catch {
      path = url.replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, '');
    }
    try {
      path = decodeURIComponent(path);
    } catch {
      // malformed escapes: keep as-is
    }
    return path.replace(/[\\/_\-.+=&?#%,:;~@!$'()[\]{}|]+/g, ' ');
  }

  function createMatcher(options = {}) {
    const opts = {
      webs: false,
      arachnids: false,
      allowSpiderMan: true,
      extraBlock: [],
      extraAllow: [],
      ...options,
    };
    const cats = [['spiders', [...CATEGORIES.spiders, ...opts.extraBlock.map(userTerm).filter(Boolean)]]];
    if (opts.webs) cats.push(['webs', CATEGORIES.webs]);
    if (opts.arachnids) cats.push(['arachnids', CATEGORIES.arachnids]);
    const compiled = cats.map(([name, terms]) => ({ name, ...compileCategory(terms) }));

    const allowSources = [...NOT_SPIDERS];
    if (opts.allowSpiderMan) allowSources.push(...SPIDER_MAN);
    for (const w of opts.extraAllow) {
      const s = String(w).trim();
      if (s) allowSources.push(s.split(/\s+/).map(escapeRe).join('[\\s\\-_.]*'));
    }
    // A phrase must end at a word boundary ("spider man" is not "spider mansion"),
    // except in scripts that do not separate words with spaces.
    const spaced = allowSources.filter((s) => !NO_SPACE_SCRIPTS.test(s));
    const unspaced = allowSources.filter((s) => NO_SPACE_SCRIPTS.test(s));
    const allowRegex = new RegExp(
      [`(?:${spaced.map((s) => `(?:${s})`).join('|')})(?![${LETTER}])`, ...unspaced.map((s) => `(?:${s})`)].join('|'),
      'giu',
    );

    function* matches(text, inPlace = false) {
      const prepared = inPlace ? prepareInPlace(text, allowRegex) : prepare(text, allowRegex);
      if (!prepared.trim()) return;
      for (const cat of compiled) {
        cat.regex.lastIndex = 0;
        let m;
        while ((m = cat.regex.exec(prepared))) {
          if (m[0] === '') {
            cat.regex.lastIndex++;
            continue;
          }
          const index = m.findIndex((g, i) => i > 0 && g !== undefined);
          const term = cat.list[index - 1];
          if (term.unless && term.unless.test(prepared)) continue;
          yield { term: m[0], category: cat.name, index: m.index };
        }
      }
    }

    return {
      // First match in `text`, or null.
      find(text) {
        for (const hit of matches(text)) return hit;
        return null;
      },
      // Number of matches in `text`, stopping early at `max`.
      count(text, max = Infinity) {
        let n = 0;
        for (const _ of matches(text)) if (++n >= max) break;
        return n;
      },
      // Positions of every match in `text`, as [{ index, length }].
      spans(text) {
        const out = [];
        for (const hit of matches(text, true)) out.push({ index: hit.index, length: hit.term.length });
        return out;
      },
    };
  }

  root.SpiderBlockTerms = Object.freeze({ createMatcher, textFromUrl, CATEGORIES });
})(globalThis);
