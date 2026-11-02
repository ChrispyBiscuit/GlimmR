"""Shrinks the CLIP image encoder for download: 8-bit weight-only quantization of its MatMuls (352 MB -> 98 MB).

Activations stay in float, so embeddings match the original closely (cosine >= 0.9998 on test photos), unlike
full dynamic quantization. The output is byte-for-byte reproducible with the pinned versions in
.github/workflows/models.yml, which is how CI checks it against the hash in src/main/tagging/model.json.

  python scripts/quantize-clip.py visual.onnx clip-vit-b32-visual-w8.onnx
"""

import sys

import onnx
from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer

src, dst = sys.argv[1], sys.argv[2]
quantizer = MatMulNBitsQuantizer(onnx.load(src), algo_config=DefaultWeightOnlyQuantConfig(block_size=128, is_symmetric=True, bits=8))
quantizer.process()
quantizer.model.save_model_to_file(dst, False)
