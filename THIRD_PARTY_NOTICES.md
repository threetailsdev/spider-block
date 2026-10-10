# Third-party notices

Spider Block includes the following third-party software and data, each under
its own license.

## TensorFlow.js

Files: `vendor/tf-core.min.js`, `vendor/tf-converter.min.js`,
`vendor/tf-backend-cpu.min.js`, `vendor/tf-backend-wasm.min.js`,
`vendor/tfjs-backend-wasm.wasm`, `vendor/tfjs-backend-wasm-simd.wasm`
(copied unmodified from the npm packages `@tensorflow/tfjs-core`,
`@tensorflow/tfjs-converter`, `@tensorflow/tfjs-backend-cpu` and
`@tensorflow/tfjs-backend-wasm`, version 4.22.0).

Copyright 2018-2024 Google LLC. Licensed under the Apache License, Version 2.0.
Source: https://github.com/tensorflow/tfjs

## MobileNet v2 image classifier

Files: `src/model/model.json`, `src/model/mobilenet_v2.bin`.

The MobileNet v2 (depth multiplier 1.0, 224x224) ImageNet classifier published
by Google for TensorFlow.js at
https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/,
with its weights converted from float32 to float16 by `scripts/fetch-model.mjs`.

Copyright Google LLC. Licensed under the Apache License, Version 2.0.
Paper: Sandler et al., "MobileNetV2: Inverted Residuals and Linear
Bottlenecks", CVPR 2018.

## Apache License 2.0

The full text of the Apache License, Version 2.0 is available at
https://www.apache.org/licenses/LICENSE-2.0.
