// On-device spider recognition with MobileNet v2, an image classifier trained on
// the 1,000 ImageNet categories. Several of those categories are spiders, which is
// all we need. Images never leave the computer.
(function (root) {
  'use strict';

  const SIZE = 224;

  // ImageNet class numbers. The model puts an extra "background" class first, so
  // output index = class number + 1.
  const CLASSES = Object.freeze({
    // harvestman (daddy longlegs), black-and-gold garden spider, barn spider,
    // garden spider, black widow, tarantula, wolf spider
    spider: [70, 72, 73, 74, 75, 76, 77],
    web: [815],
    // scorpion, tick
    arachnid: [71, 78],
  });

  let modelPromise = null;
  let chain = Promise.resolve();

  async function pickBackend(tf, api) {
    if (tf.wasm && typeof WebAssembly === 'object') {
      try {
        tf.env().set('WASM_HAS_MULTITHREAD_SUPPORT', false);
        tf.wasm.setWasmPaths(api.runtime.getURL('vendor/'));
        if (await tf.setBackend('wasm')) return 'wasm';
      } catch (err) {
        console.warn('Spider Block: WebAssembly unavailable, using the slower JavaScript engine.', err);
      }
    }
    await tf.setBackend('cpu');
    return 'cpu';
  }

  function init() {
    if (!modelPromise) {
      modelPromise = (async () => {
        const tf = root.tf;
        const backend = await pickBackend(tf, root.sbApi);
        const model = await tf.loadGraphModel(root.sbApi.runtime.getURL('model/model.json'));
        // The first run compiles kernels; do it now so the first real image is quick.
        tf.tidy(() => model.predict(tf.zeros([1, SIZE, SIZE, 3])));
        return { tf, model, backend };
      })();
      modelPromise.catch(() => {
        modelPromise = null;
      });
    }
    return modelPromise;
  }

  // `pixels` holds `count` RGB images of 224x224, values 0..1. Returns the highest
  // probability per category across all of them.
  function score(pixels, count) {
    const run = chain.then(async () => {
      const { tf, model, backend } = await init();
      const probs = tf.tidy(() => tf.softmax(model.predict(tf.tensor4d(pixels, [count, SIZE, SIZE, 3]))));
      const data = await probs.data();
      probs.dispose();
      const classes = data.length / count;
      const offset = classes === 1001 ? 1 : 0;
      const result = { spider: 0, web: 0, arachnid: 0, backend };
      for (let i = 0; i < count; i++) {
        const base = i * classes + offset;
        for (const [name, ids] of Object.entries(CLASSES)) {
          let sum = 0;
          for (const id of ids) sum += data[base + id];
          if (sum > result[name]) result[name] = sum;
        }
      }
      return result;
    });
    // Inference runs one batch at a time; a failure must not block the queue.
    chain = run.catch(() => {});
    return run;
  }

  root.SpiderBlockClassifier = Object.freeze({ init, score, SIZE });
})(globalThis);
