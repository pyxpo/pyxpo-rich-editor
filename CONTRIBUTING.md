# Contributing to pyxpo-rich-editor

Thanks for helping. Bug reports, fixes, docs and new examples are all welcome.

## Set up

pyxpo-rich-editor is developed next to the pyxpo core repo:

```sh
mkdir pyxpo-dev && cd pyxpo-dev
git clone https://github.com/pyxpo/pyxpo.git
mkdir pyxpo-packages && git clone https://github.com/pyxpo/pyxpo-rich-editor.git pyxpo-packages/pyxpo-rich-editor
pyxpo/tools/dev_install.sh
```

`dev_install.sh` makes `pyxpo/.venv` and installs the core and every package in it as editable installs, so changes
here show up in the core examples and test apps without a reinstall.

## Run the tests

```sh
cd pyxpo-packages/pyxpo-rich-editor
../../pyxpo/.venv/bin/python -m pytest -q
```

The tests use `FakeBridge` from `pyxpo.module_testing`, so they run without a device. For a change to the Swift or Kotlin
code, also run a demo app on the Android emulator and the iOS simulator, and say in the pull request what you checked.

## Change the editor page

The editor is a TypeScript page in `editor-src/`, built into one HTML string in `pyxpo_rich_editor/_bundle.py`.
After a change there, rebuild it and commit both:

```sh
node tools/build_bundle.mjs --modules <node_modules dir>
```

The `node_modules` folder needs `@tiptap/*` 3.x, `marked`, `lucide-react` and `esbuild`. To try the page in a
browser, open the `HTML` string from `_bundle.py` as a file: it posts its messages to the parent window.

## Pull requests

- Keep one change per pull request, with a test for a bug fix or a new feature.
- Add a line under `## Unreleased` in `CHANGELOG.md`.
- Update `README.md` when you change the public API.
- Package code must run on Python 3.9.

## Releases

Maintainers release by pushing a tag `v<version>` that matches `__version__` in `pyxpo_rich_editor/__init__.py`. The
`release` workflow tests, builds and publishes it to PyPI.
