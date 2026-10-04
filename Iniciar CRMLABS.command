#!/bin/bash
# CRMLABS — iniciar no Mac (duplo clique).
# Na primeira vez instala as dependências e prepara o banco local; depois abre direto.
cd "$(dirname "$0")" || exit 1
clear
echo ""
echo "  CRMLABS — iniciando"
echo "  ─────────────────────────────────────────────"
echo ""

# Garante o Node.js 20.9+. Usa o do sistema, se houver; senão baixa uma cópia
# portátil do site oficial (nodejs.org) para a pasta "runtime" — sem instalar
# nada no Mac e sem pedir senha.
export PATH="$PWD/runtime/node/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 && export PATH="$PWD/runtime/node/bin:$PATH"

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local maj min
  maj=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null) || return 1
  min=$(node -p "process.versions.node.split('.')[1]" 2>/dev/null) || return 1
  [ "$maj" -gt 20 ] || { [ "$maj" -eq 20 ] && [ "$min" -ge 9 ]; }
}

if ! node_ok; then
  ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH="x64"
  echo "  Node.js não encontrado. Baixando uma cópia portátil do site oficial (uma vez só)…"
  mkdir -p runtime && cd runtime || exit 1
  BASE="https://nodejs.org/dist/latest-v24.x"
  FILE=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk '{print $2}' | grep -E "^node-v[0-9.]+-darwin-${ARCH}\.tar\.gz$" | head -1)
  if [ -z "$FILE" ]; then
    echo "  Não consegui acessar nodejs.org. Verifique a internet e tente de novo."
    read -n 1 -s -r -p "  Pressione qualquer tecla para fechar…"; exit 1
  fi
  curl -fL --progress-bar -o "$FILE" "$BASE/$FILE" || { echo "  Falha no download."; read -n 1 -s -r -p "  Pressione qualquer tecla para fechar…"; exit 1; }
  EXPECTED=$(curl -fsSL "$BASE/SHASUMS256.txt" | grep " $FILE\$" | awk '{print $1}')
  ACTUAL=$(shasum -a 256 "$FILE" | awk '{print $1}')
  if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "  A verificação de integridade do Node.js falhou. Arquivo descartado."
    rm -f "$FILE"; read -n 1 -s -r -p "  Pressione qualquer tecla para fechar…"; exit 1
  fi
  rm -rf node && mkdir node && tar -xzf "$FILE" -C node --strip-components=1 && rm -f "$FILE"
  cd .. || exit 1
  hash -r
  if ! node_ok; then
    echo "  Não foi possível preparar o Node.js."; read -n 1 -s -r -p "  Pressione qualquer tecla para fechar…"; exit 1
  fi
fi
echo "  Node.js $(node -v) encontrado."

# Instala as dependências na primeira vez (ou se o package-lock mudar).
LOCK_HASH=$(shasum package-lock.json | cut -d' ' -f1)
if [ ! -d node_modules ] || [ "$(cat node_modules/.crmlabs-lock 2>/dev/null)" != "$LOCK_HASH" ]; then
  echo "  Instalando dependências (só na primeira vez, alguns minutos)…"
  npm ci --no-audit --no-fund --loglevel=error || { echo ""; echo "  Falha ao instalar. Verifique a internet e tente de novo."; read -n 1 -s -r -p "  Pressione qualquer tecla para fechar…"; exit 1; }
  echo "$LOCK_HASH" > node_modules/.crmlabs-lock
  rm -rf .next
fi

node_modules/.bin/tsx scripts/local.ts
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo ""; read -n 1 -s -r -p "  Pressione qualquer tecla para fechar…"
fi
exit $STATUS
