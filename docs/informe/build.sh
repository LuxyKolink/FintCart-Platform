#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  build.sh — Build the UPB report (docs/informe).
#
#  Usage:
#    ./build.sh          # compile with latexmk (runs pdflatex + biber as needed)
#    ./build.sh force    # ignore the cache (latexmk -g). Use after editing
#                        # refs/referencias.bib or when latexmk says "Nothing to do"
#    ./build.sh clean    # remove all aux files (latexmk -C)
#
#  The underlying command (verified on this machine; Docker needs no sudo here):
#    docker run --rm -v "<repo>/docs/informe:/src" -w /src texlive/texlive:latest \
#      latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
#
#  OWNERSHIP — read before changing the docker flags:
#  This machine uses idmapped bind mounts. The mapping measured on 2026-10-27 is
#  container uid 0 -> host uid 1000 (you), container uid 1000 -> host uid 525287.
#  Therefore run the container as root (the default) and NEVER pass `-u $(id -u)`:
#  that yields "Cannot write file main.aux". Do not add a chown step either — it
#  rewrites every file in the directory to an unmappable uid.
# ---------------------------------------------------------------------------
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "clean" ]]; then
  docker run --rm -v "${SRC_DIR}:/src" -w /src \
    texlive/texlive:latest latexmk -C
  exit 0
fi

FORCE_FLAG=""
if [[ "${1:-}" == "force" ]]; then
  FORCE_FLAG="-g"
fi

docker run --rm -v "${SRC_DIR}:/src" -w /src \
  texlive/texlive:latest \
  latexmk -pdf -interaction=nonstopmode -halt-on-error ${FORCE_FLAG} main.tex
