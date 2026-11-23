"""PreToolUse (Bash): bloquea git add / git commit si hay archivos sensibles.

Revisa:
- .env y .env.* (salvo .env.example)
- *.pem y *.key
- *.toml que contenga asignaciones de contraseñas o tokens
Sale con código 2 para bloquear; el motivo va a stderr.
"""
import json
import os
import re
import shlex
import subprocess
import sys

PATRON_SECRETO_TOML = re.compile(
    r"(password|passwd|contrase\w*|secret|token|api_?key)\s*=\s*['\"][^'\"]+['\"]",
    re.IGNORECASE,
)


def archivo_sensible(ruta):
    nombre = os.path.basename(ruta)
    if nombre == ".env" or (nombre.startswith(".env.") and nombre != ".env.example"):
        return "archivo .env"
    if nombre.endswith(".pem") or nombre.endswith(".key"):
        return "clave/certificado"
    if nombre.endswith(".toml") and os.path.isfile(ruta):
        try:
            with open(ruta, encoding="utf-8", errors="ignore") as f:
                if PATRON_SECRETO_TOML.search(f.read()):
                    return "toml con contraseña o token"
        except OSError:
            pass
    return None


def git(*args):
    r = subprocess.run(["git", *args], capture_output=True, text=True)
    return r.stdout.splitlines() if r.returncode == 0 else []


def archivos_a_revisar(comando):
    if re.search(r"\bgit\s+commit\b", comando):
        return git("diff", "--cached", "--name-only")
    m = re.search(r"\bgit\s+add\b(.*)", comando)
    if not m:
        return []
    args = []
    for tok in shlex.split(m.group(1), posix=True) if m.group(1).strip() else []:
        if tok in ("-A", "--all", ".", "-u", "--update"):
            # Agregar todo: revisar también lo no rastreado y modificado.
            args.extend(git("ls-files", "--others", "--modified", "--exclude-standard"))
        elif not tok.startswith("-"):
            args.append(tok)
    return args


def main():
    try:
        entrada = json.load(sys.stdin)
    except (ValueError, OSError):
        return 0
    if entrada.get("tool_name") != "Bash":
        return 0
    comando = (entrada.get("tool_input") or {}).get("command", "")
    if not re.search(r"\bgit\s+(add|commit)\b", comando):
        return 0

    hallazgos = []
    for ruta in archivos_a_revisar(comando):
        motivo = archivo_sensible(ruta)
        if motivo:
            hallazgos.append(f"  - {ruta} ({motivo})")

    if hallazgos:
        sys.stderr.write(
            "Bloqueado: hay archivos sensibles en git add/commit:\n"
            + "\n".join(hallazgos)
            + "\nSacalos del índice (git reset -- <archivo>) y revisá .gitignore.\n"
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
