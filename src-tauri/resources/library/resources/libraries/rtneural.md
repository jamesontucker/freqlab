---
name: RTNeural
description: Real-time neural network inference library for audio. Essential for running trained amp/effect models in plugins.
url: https://github.com/jatinchowdhury18/RTNeural
license: BSD-3-Clause
copyright: Jatin Chowdhury
tags: [neural-network, ml, amp-sim, inference, simd]
---

# RTNeural

Real-time safe neural network inference library optimized for audio applications.

## Overview

RTNeural runs trained neural networks (from PyTorch, TensorFlow, Keras) in real-time audio plugins. Commonly used for amp modeling, effect emulation, and smart audio processing.

## When to Use

| Use Case | Why RTNeural |
|----------|--------------|
| Amp modeling | Run Neural Amp Modeler captures |
| Effect cloning | Capture hardware units as neural models |
| Smart processing | ML-based dynamics, EQ matching |
| Real-time inference | Designed for audio thread safety |

## Key Features

- **Real-time Safe**: No allocations during inference
- **SIMD Optimized**: AVX, SSE, NEON acceleration
- **Multiple Backends**: Eigen, xsimd, or custom
- **Model Import**: Load from JSON (Keras), ONNX, custom formats
- **Stateful Layers**: LSTM, GRU for temporal modeling

## Supported Layers

- Dense (fully connected)
- Conv1D
- LSTM, GRU (recurrent)
- BatchNorm
- PReLU, tanh, sigmoid activations

## Workflow

1. **Train model** in Python (PyTorch/TensorFlow)
2. **Export** to JSON/ONNX format
3. **Load** in C++ plugin using RTNeural
4. **Process** audio in real-time

## Attribution Required

```rust
// Neural network inference using RTNeural
// Copyright (c) Jatin Chowdhury
// License: BSD-3-Clause
// https://github.com/jatinchowdhury18/RTNeural
```

## Resources

- **Repository**: https://github.com/jatinchowdhury18/RTNeural
- **Documentation**: https://github.com/jatinchowdhury18/RTNeural/tree/main/docs
- **Neural Amp Modeler**: https://github.com/sdatkinson/NeuralAmpModelerPlugin

## Related

- Neural Amp Modeler for training amp models
- ChowDSP WDF for physics-based (non-ML) circuit modeling
