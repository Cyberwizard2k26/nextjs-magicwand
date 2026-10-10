#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PhantomRipperRMM — standard obfuscator.

Ported from OSRipper's obfuscator.py. Multi-layer base64+zlib wrapping with
randomized decoder identifiers to defeat static signatures. Deliberately avoids
`marshal` so the output is portable across Python minor versions.

Usage:  python obfuscator.py <file.py>
Output: <base>_or.py  (next to the input)
"""

import base64
import os
import random
import secrets
import string
import sys
import zlib

LOOP_MIN, LOOP_MAX = 40, 65


def _rand_name(length=2):
    return "".join(secrets.choice(string.ascii_lowercase) for _ in range(length))


def _decoder_line():
    dec_var = _rand_name(random.randint(2, 4))
    arg_var = _rand_name(random.randint(2, 4))
    while arg_var == dec_var:
        arg_var = _rand_name(random.randint(2, 4))
    style = random.randint(0, 2)
    if style == 0:
        return (f"{dec_var} = lambda {arg_var}: "
                f"__import__('zlib').decompress(__import__('base64').b64decode({arg_var}[::-1]));", dec_var)
    if style == 1:
        z, b = _rand_name(1), _rand_name(1)
        return (f"{z}=__import__('zlib');{b}=__import__('base64');"
                f"{dec_var}=lambda {arg_var}:{z}.decompress({b}.b64decode({arg_var}[::-1]));", dec_var)
    m = _rand_name(1)
    return (f"{m}=__import__('base64');"
            f"{dec_var}=lambda {arg_var}:__import__('zlib').decompress(getattr({m},'b64decode')({arg_var}[::-1]));",
            dec_var)


def encode(source, output):
    loop = random.randint(LOOP_MIN, LOOP_MAX)
    decoder_line, dec_var = _decoder_line()
    blob = base64.b64encode(zlib.compress(source.encode("utf-8")))[::-1]
    body = repr(blob)
    for _ in range(loop):
        inner = "exec((%s)(%s))" % (dec_var, body)
        body = repr(base64.b64encode(zlib.compress(inner.encode("utf-8")))[::-1])
    final = decoder_line + "\n" + "exec((%s)(%s))\n" % (dec_var, body)
    with open(output, "w", encoding="utf-8") as fh:
        fh.write(final)


def main():
    if len(sys.argv) < 2:
        sys.exit("Usage: python obfuscator.py <file.py>")
    src = sys.argv[1]
    if not os.path.isfile(src):
        sys.exit("File not found: %s" % src)
    with open(src, "r", encoding="utf-8", errors="ignore") as fh:
        data = fh.read()
    base = os.path.basename(src).lower().replace(".py", "")
    out = os.path.join(os.path.dirname(src), base + "_or.py")
    encode(data, out)
    print("[+] obfuscated -> %s (%d bytes)" % (out, os.path.getsize(out)))


if __name__ == "__main__":
    main()
