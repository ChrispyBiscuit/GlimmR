"""Builds src/main/tagging/clip-labels.json from scripts/clip-vocabulary.json.

Each label's text embedding is the normalised mean of its prompts' embeddings (prompt ensembling). Only the
image model ships with the app; the text model is needed here, once, whenever the vocabulary changes.

Needs: Python 3.10+, `pip install onnxruntime numpy ftfy regex`, the CLIP ViT-B/32 text model as ONNX and
OpenAI's BPE tokenizer (open_clip's tokenizer.py and bpe_simple_vocab_16e6.txt.gz):

  python scripts/build-clip-labels.py --text-model textual.onnx --tokenizer-dir path/to/open_clip
"""

import argparse
import base64
import gzip
import html
import json
import os
from functools import lru_cache

import numpy as np
import onnxruntime as ort
import regex as re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# OpenAI CLIP's byte-level BPE (from the CLIP repository, MIT licence), trimmed to encoding.
@lru_cache()
def bytes_to_unicode():
    bs = list(range(ord('!'), ord('~') + 1)) + list(range(ord('¡'), ord('¬') + 1)) + list(range(ord('®'), ord('ÿ') + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return dict(zip(bs, map(chr, cs)))


class Tokenizer:
    def __init__(self, bpe_path):
        merges = gzip.open(bpe_path).read().decode('utf-8').split('\n')[1 : 49152 - 256 - 2 + 1]
        merges = [tuple(m.split()) for m in merges]
        vocab = list(bytes_to_unicode().values())
        vocab = vocab + [v + '</w>' for v in vocab] + [''.join(m) for m in merges] + ['<|startoftext|>', '<|endoftext|>']
        self.encoder = dict(zip(vocab, range(len(vocab))))
        self.ranks = dict(zip(merges, range(len(merges))))
        self.byte_encoder = bytes_to_unicode()
        self.pat = re.compile(r"""<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""", re.IGNORECASE)
        self.cache = {}

    def bpe(self, token):
        if token in self.cache:
            return self.cache[token]
        word = tuple(token[:-1]) + (token[-1] + '</w>',)
        while len(word) > 1:
            pairs = {(word[i], word[i + 1]) for i in range(len(word) - 1)}
            best = min(pairs, key=lambda p: self.ranks.get(p, float('inf')))
            if best not in self.ranks:
                break
            first, second = best
            out, i = [], 0
            while i < len(word):
                if i < len(word) - 1 and word[i] == first and word[i + 1] == second:
                    out.append(first + second)
                    i += 2
                else:
                    out.append(word[i])
                    i += 1
            word = tuple(out)
        self.cache[token] = word
        return word

    def encode(self, text, length=77):
        text = re.sub(r'\s+', ' ', html.unescape(html.unescape(text))).strip().lower()
        ids = [self.encoder['<|startoftext|>']]
        for token in re.findall(self.pat, text):
            token = ''.join(self.byte_encoder[b] for b in token.encode('utf-8'))
            ids.extend(self.encoder[t] for t in self.bpe(token))
        ids = ids[: length - 1] + [self.encoder['<|endoftext|>']]
        return ids + [0] * (length - len(ids))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--text-model', required=True)
    ap.add_argument('--tokenizer-dir', required=True, help='folder with bpe_simple_vocab_16e6.txt.gz')
    ap.add_argument('--out', default=os.path.join(ROOT, 'src', 'main', 'tagging', 'clip-labels.json'))
    args = ap.parse_args()

    tok = Tokenizer(os.path.join(args.tokenizer_dir, 'bpe_simple_vocab_16e6.txt.gz'))
    session = ort.InferenceSession(args.text_model, providers=['CPUExecutionProvider'])

    def embed(prompts):
        ids = np.array([tok.encode(p) for p in prompts], dtype=np.int32)
        e = session.run(None, {'input_ids': ids, 'attention_mask': (ids != 0).astype(np.int32)})[0]
        e = e / np.linalg.norm(e, axis=1, keepdims=True)
        m = e.mean(0)
        return m / np.linalg.norm(m)

    def b64(v):
        return base64.b64encode(np.asarray(v, dtype='<f4').tobytes()).decode()

    vocab = json.load(open(os.path.join(ROOT, 'scripts', 'clip-vocabulary.json')))
    out = {'model': 'openai/clip-vit-base-patch32', 'dim': 512, 'groups': [], 'attributes': []}
    for g in vocab['groups']:
        templates = vocab['templates'][g['template']]
        labels = [{'tag': l['tag'], 'embedding': b64(embed([t.format(l['text']) for t in templates]))} for l in g['labels']]
        out['groups'].append({'id': g['id'], 'title': g['title'], 'threshold': g['threshold'], 'max': g['max'], 'labels': labels})
    for a in vocab['attributes']:
        out['attributes'].append({'tag': a['tag'], 'threshold': a['threshold'], 'suppresses': a.get('suppresses', []), 'yes': b64(embed(a['yes'])), 'no': b64(embed(a['no']))})
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
        f.write('\n')
    print(f'{args.out}: {sum(len(g["labels"]) for g in out["groups"])} labels, {len(out["attributes"])} attributes')


if __name__ == '__main__':
    main()
