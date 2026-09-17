#!/usr/bin/env bash
set -euo pipefail
umask 077

signing_dir="${IOS_SIGNING_DIR:-$HOME/podium-signing/ios}"
mkdir -p "$signing_dir"
key="$signing_dir/podium-distribution.key"
csr="$signing_dir/podium-distribution.csr"
# Never replace a key: the downloaded certificate is tied to this exact key.
if [[ -e "$key" || -e "$csr" ]]; then
  printf 'Signing key or CSR already exists in %s; keep it for the matching certificate.\n' "$signing_dir" >&2
  exit 1
fi
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$key"
# Git Bash otherwise rewrites /CN=... into a Windows path.
MSYS2_ARG_CONV_EXCL='/CN=' openssl req -new -sha256 -key "$key" \
  -subj '/CN=PODIUM Distribution/O=BFT MENA/C=QA' -out "$csr"
chmod 600 "$key" "$csr"
printf 'CSR: %s\nPrivate key (keep private): %s\n' "$csr" "$key"
