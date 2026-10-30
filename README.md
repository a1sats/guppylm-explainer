# GuppyLM, explained

Live site: https://a1sats.github.io/guppylm-explainer/

An interactive, standalone explainer for [GuppyLM](https://github.com/arman-bd/guppylm) — a ~9M-parameter language model that talks like a small fish.

The site starts with the whole pipeline in one picture (data → tokenizer → model → training → inference), then goes deep into each stage. It is written for engineers who have not trained a model before: every term is defined, and every interactive demo is grounded in the actual project.

## What is real

- 300 training conversations sampled from the actual generated dataset (five per topic, all 60 topics).
- Exact tokenization from the shipped `tokenizer.json` (byte-level BPE, 2,418 real tokens, 2,352 merges).
- Attention weights and next-token distributions extracted from the published `arman-bd/guppylm-9M` checkpoint with PyTorch.
- A real 500-step training curve produced by the repo's own training loop on CPU.
- Held-out loss 0.407 (perplexity 1.50) measured on the 3,000-example split.

## Run locally

Open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
```

There is no build step and no external dependency. Everything is plain HTML, CSS, and JavaScript.

## Contents

00 The whole picture · 01 Where the data comes from · 02 Text becomes integers · 03 What the model computes · 04 How numbers get better · 05 One training step · 06 From weights to a reply · 07 Results and limits · 08 Glossary · 09 Check yourself

## License

The explainer text and code are provided for educational use. GuppyLM itself is MIT-licensed and created by [arman-bd](https://github.com/arman-bd).
