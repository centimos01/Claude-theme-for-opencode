#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
set -euo pipefail

usage() {
  cat <<'EOF'
Instala el tema Claude para OpenCode V2.

Uso:
  ./install.sh [opciones]

Opciones:
  --mode <dark|light|system>  Modo del tema (por defecto: dark)
  --no-activate               Copia el tema sin modificar cli.json
  -h, --help                  Muestra esta ayuda

Variables:
  XDG_CONFIG_HOME             Si está definida, se usa como raíz de configuración.
EOF
}

no_activate=0
mode=dark

while (($#)); do
  case "$1" in
    --mode)
      if (($# < 2)); then
        echo "Falta el valor de --mode" >&2
        exit 1
      fi
      mode="$2"
      shift
      ;;
    --mode=*)
      mode="${1#*=}"
      ;;
    --no-activate)
      no_activate=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Opción desconocida: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

case "$mode" in
  dark|light|system) ;;
  *)
    echo "Modo inválido: $mode (usa dark, light o system)" >&2
    exit 1
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
source_file="$script_dir/themes/claude.json"

if [[ ! -f "$source_file" ]]; then
  echo "No se encontró el tema en $source_file" >&2
  exit 1
fi

config_root="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
themes_dir="$config_root/themes"
destination="$themes_dir/claude.json"
cli_path="$config_root/cli.json"

mkdir -p "$themes_dir"

backup_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    local backup
    backup="$(mktemp "${path}.bak-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
    if ! cp -p "$path" "$backup"; then
      rm -f "$backup"
      return 1
    fi
    printf '  Backup: %s\n' "$backup"
  fi
}

backup_file "$destination"
cp "$source_file" "$destination"

activate_python() {
  python3 - "$cli_path" "$mode" <<'PY'
import datetime
import json
import os
import shutil
import stat
import sys
import tempfile

cli_path, mode = sys.argv[1], sys.argv[2]
target_path = os.path.realpath(cli_path) if os.path.islink(cli_path) else os.path.abspath(cli_path)
directory = os.path.dirname(target_path)

try:
    os.makedirs(directory, exist_ok=True)
except OSError as error:
    print(f"No se pudo preparar el directorio de configuración: {error}", file=sys.stderr)
    raise SystemExit(3)

if os.path.exists(target_path):
    try:
        with open(target_path, encoding="utf-8-sig") as handle:
            data = json.load(handle)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        print(f"cli.json no es JSON válido: {error}", file=sys.stderr)
        raise SystemExit(2)
    except OSError as error:
        print(f"No se pudo leer cli.json: {error}", file=sys.stderr)
        raise SystemExit(3)

    if not isinstance(data, dict):
        print("cli.json debe contener un objeto JSON en la raíz.", file=sys.stderr)
        raise SystemExit(2)

    try:
        original_mode = stat.S_IMODE(os.stat(target_path).st_mode)
    except OSError as error:
        print(f"No se pudo leer cli.json: {error}", file=sys.stderr)
        raise SystemExit(3)

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = None
    try:
        descriptor, backup = tempfile.mkstemp(
            prefix=f"{os.path.basename(target_path)}.bak-{stamp}-",
            dir=directory,
        )
        os.close(descriptor)
        shutil.copy2(target_path, backup)
    except OSError as error:
        if backup is not None and os.path.exists(backup):
            os.remove(backup)
        print(f"No se pudo crear el backup de cli.json: {error}", file=sys.stderr)
        raise SystemExit(3)
    print(f"  Backup: {backup}")
else:
    data = {"$schema": "https://opencode.ai/v2/cli.json", "animations": True}
    original_mode = 0o600

data["theme"] = {"name": "claude", "mode": mode}

temporary = None
try:
    descriptor, temporary = tempfile.mkstemp(
        prefix=".cli.json-",
        suffix=".tmp",
        dir=directory,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.chmod(temporary, original_mode)
    os.replace(temporary, target_path)
except OSError as error:
    print(f"No se pudo escribir cli.json: {error}", file=sys.stderr)
    raise SystemExit(3)
finally:
    if temporary is not None and os.path.exists(temporary):
        os.remove(temporary)

print(f"  Activado: {cli_path}")
PY
}

activated=0
if [[ "$no_activate" -eq 0 ]]; then
  if command -v python3 >/dev/null 2>&1; then
    if activate_python; then
      activated=1
    else
      status=$?
      if [[ "$status" -eq 2 || "$status" -eq 3 ]]; then
        exit 1
      fi
      echo "No se pudo activar automáticamente. El tema está instalado." >&2
      echo "Actívalo con /themes o edita cli.json manualmente." >&2
    fi
  else
    echo "python3 no encontrado: el tema se instaló, pero no se activó." >&2
    echo "Añade manualmente este bloque a cli.json:" >&2
    echo '  "theme": { "name": "claude", "mode": "'"$mode"'" }' >&2
  fi
fi

printf '\nTema instalado:\n  %s\n' "$destination"
if [[ "$activated" -eq 1 ]]; then
  printf "Tema activado en modo '%s'.\n" "$mode"
else
  printf 'Activación omitida. Selecciona claude con /themes o edita cli.json.\n'
fi
printf '\nReinicia OpenCode para cargar el tema.\n'
