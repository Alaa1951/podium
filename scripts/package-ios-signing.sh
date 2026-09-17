#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo 'Usage: bash scripts/package-ios-signing.sh certificate.cer profile.mobileprovision [AuthKey_KEYID.p8]' >&2
  exit 1
fi
signing_dir="${IOS_SIGNING_DIR:-$HOME/podium-signing/ios}"
key="$signing_dir/podium-distribution.key"
[[ -f "$key" && -f "$1" && -f "$2" ]] || { echo 'Missing private key, certificate or provisioning profile.' >&2; exit 1; }
[[ $# -lt 3 || -f "$3" ]] || { echo 'API key file is missing.' >&2; exit 1; }
output="$signing_dir/github-secrets"
[[ ! -e "$output" && ! -e "$signing_dir/podium-distribution.p12" ]] || { echo 'Signing outputs already exist; move them aside explicitly before regenerating.' >&2; exit 1; }
work_dir="$(mktemp -d "$signing_dir/package.XXXXXX")"
trap 'rm -rf "$work_dir"; unset IOS_DIST_P12_PASSWORD confirmation' EXIT
if ! openssl x509 -inform DER -in "$1" -out "$work_dir/certificate.pem" 2>/dev/null; then
  openssl x509 -in "$1" -out "$work_dir/certificate.pem"
fi
openssl x509 -in "$work_dir/certificate.pem" -checkend 0 -noout
openssl pkey -in "$key" -pubout -out "$work_dir/key-public.pem"
openssl x509 -in "$work_dir/certificate.pem" -pubkey -noout > "$work_dir/certificate-public.pem"
cmp -s "$work_dir/key-public.pem" "$work_dir/certificate-public.pem" || { echo 'Certificate does not match the CSR private key.' >&2; exit 1; }
if [[ -z "${IOS_DIST_P12_PASSWORD:-}" ]]; then
  read -r -s -p 'New P12 password: ' IOS_DIST_P12_PASSWORD; printf '\n'
  read -r -s -p 'Confirm password: ' confirmation; printf '\n'
  [[ "$IOS_DIST_P12_PASSWORD" == "$confirmation" ]] || { echo 'Passwords do not match.' >&2; exit 1; }
fi
[[ -n "$IOS_DIST_P12_PASSWORD" ]] || { echo 'P12 password must not be empty.' >&2; exit 1; }
export IOS_DIST_P12_PASSWORD
openssl pkcs12 -export -inkey "$key" -in "$work_dir/certificate.pem" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -name 'PODIUM Distribution' -passout env:IOS_DIST_P12_PASSWORD \
  -out "$signing_dir/podium-distribution.p12"
mkdir -p "$output"
base64 < "$signing_dir/podium-distribution.p12" | tr -d '\r\n' > "$output/IOS_DIST_P12_BASE64.txt"
base64 < "$2" | tr -d '\r\n' > "$output/IOS_PROVISION_PROFILE_BASE64.txt"
if [[ $# -eq 3 ]]; then
  base64 < "$3" | tr -d '\r\n' > "$output/ASC_API_KEY_P8_BASE64.txt"
fi
printf 'Private base64 files: %s\nSet IOS_DIST_P12_PASSWORD to the password you supplied. No secret values were printed.\n' "$output"
