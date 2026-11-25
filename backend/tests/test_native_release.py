"""Rolling-Release für die native Installation (CI, docker-publish.yml).

update-native.sh entpackt nur, was zur Prüfsumme passt. Lädt die CI die Prüfsumme
VOR dem Paket hoch und bricht das Paket ab, liegt eine neue Prüfsumme neben dem
alten Paket — jedes native Update scheitert (v1.1.75, v1.1.83). Deshalb: Paket
zuerst, Prüfsumme zuletzt, jede mit Wiederholung.
"""
import os

WF = os.path.join(os.path.dirname(__file__), "..", "..", ".github", "workflows", "docker-publish.yml")


def _schritt():
    s = open(WF, encoding="utf-8").read()
    start = s.index("- name: Publish rolling native release")
    ende = s.find("\n      - name:", start + 10)
    return s[start:ende if ende > 0 else len(s)]


def test_pruefsumme_kommt_zuletzt():
    step = _schritt()
    paket = step.index("upload printloom-frontend-dist.tar.gz\n")
    summe = step.index("upload printloom-frontend-dist.tar.gz.sha256")
    assert paket < summe


def test_upload_wiederholt_und_ohne_fremd_action():
    step = _schritt()
    assert "softprops" not in step and "uses:" not in step
    assert "--clobber" in step and "for i in" in step
    assert "set -euo pipefail" in step
