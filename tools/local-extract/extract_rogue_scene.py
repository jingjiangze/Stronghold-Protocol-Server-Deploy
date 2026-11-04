#!/usr/bin/env python3
"""Extract roguelike battlefield scenes (整合战略) from a local client into scene/<stageId>/.

scenes.py's SCENES table holds the 卫戍协议 battlefields only. A roguelike stage is a Unity scene of the same shape —
scenes/obt/roguelike/ro<N>/level_rogue<N>_<code>/level_rogue<N>_<code>.ab with …/<level_rogue<N>_<code>>/lightingdata.ab
beside it (scenes.scene_bundle maps the stage id) — so this script runs the same scenes.export_scene for one stage
(--stage) or for every active stage of a theme (--theme ro4 = every active `rogue_ro4_*` stage of data/stages.json;
several themes may be named at once — `--theme ro1,ro2,ro3,ro5,ro6` — and one run then indexes the client once)
and merges the new `scene/<stageId>` groups into the local-assets manifests; every other group is kept and `count`
becomes the sum of the groups' entries (tools/setup.mjs compares it that way).

Scene data goes to <out>/scene/<stageId>/: scene.json, scene.bin and the lightmap pages (lm<i>.png + the lm<i>.webp
the manifest lists) — the same files a `--only scene` run writes. The materials' textures go to the shared scene/tex
directory (the same <name>.png + <name>.webp pair per texture) and their entries are merged into the scene/tex group:
entries already there are kept and their files are not encoded again, so extracting a stage never drops another
stage's textures. A destination file that already has the same bytes is left alone, so a stage that is up to date is
skipped; `--theme` reports new / up-to-date / failed stages and carries on after a failure.

Dependencies: the theme's materials / textures and the background mesh (ROGUE_DEPS, for the stages it lists), the
shader bundles extract.py loads for any Material export, the client's anonymized unity_builtin bundle (the
Default-Material of the S_Background_common renderer; its file name is a content hash, so it is found by its
AssetBundle name when the known name is gone) and, for every other stage, the dependencies its own scene bundle lists
(AssetBundle.m_Dependencies names the CAB-<hash> of each one, so the client's art bundles are indexed once to turn
those names into paths). A dependency that is missing leaves that material's sub-mesh out, which export_scene logs.

Usage:
  python tools/local-extract/extract_rogue_scene.py --game "<install dir or AB root>" --stage rogue_ro4_1-1
  python tools/local-extract/extract_rogue_scene.py --game "<install dir or AB root>" --stage id1 --stage id2 …
  python tools/local-extract/extract_rogue_scene.py --game "<install dir or AB root>" --theme ro4
  python tools/local-extract/extract_rogue_scene.py --game "<install dir or AB root>" --theme ro1,ro2,ro3,ro5,ro6
         [--out public/assets/local] [--manifest data/local-assets.json] [--keep-stage]

With no --manifest both copies of the repository's manifest are updated (data/local-assets.json and
plugins/mota/data/local-assets.json). Everything is (c) Hypergryph; for private, non-commercial fan use only.
"""
import argparse
import filecmp
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract  # noqa: E402  (locate_client, material_info, dep_bundles)
import scenes  # noqa: E402  (export_scene, scene_bundle, find_scene)

ROOT = Path(__file__).resolve().parents[2]
# Manifest copies of the repository this writes to when no --manifest is given.
MANIFESTS = ('data/local-assets.json', 'plugins/mota/data/local-assets.json')
# The stage table `--theme` takes its stage ids from: every key `rogue_<theme>_*` whose record is active.
STAGES = 'data/stages.json'
# Theme bundles each supported roguelike scene draws from: materials / textures, then the background mesh. They are
# the dependencies the scene bundle lists in the official asset index; an unresolved material makes export_scene skip
# that sub-mesh, so a missing path here shows up as `sub-meshes without a material` in the log.
ROGUE_DEPS = {
    'rogue_ro4_1-1': [
        'arts/maps/map_smelter/res.ab',
        'arts/maps/map_smelter/background_mesh/s_background_common.ab',
    ],
}
# Unity's builtin resources bundle as this client ships it (content-addressed name, no container path): it holds the
# Default-Material of the level_rogue4_1-1 background plane. See find_builtin for the fallback.
BUILTIN = 'anon/dfba18b16546da2b44cbbe0fa4019066.bin'
BUILTIN_NAME = 'unity_builtin.ab'


def find_builtin(ab_root, log):
    """The client's unity_builtin bundle, or None. The known name first; else anon/*.bin scanned for the bundle whose
    AssetBundle name is unity_builtin.ab (a client update changes the hash)."""
    known = Path(ab_root) / BUILTIN
    if known.is_file():
        return known
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    for bundle in sorted((Path(ab_root) / 'anon').glob('*.bin')):
        try:
            env = UnityPy.load(str(bundle))
        except Exception:  # not a bundle this UnityPy reads
            continue
        for o in env.objects:
            if o.type.name != 'AssetBundle':
                continue
            try:
                name = o.read_typetree().get('m_AssetBundleName')
            except Exception:
                name = None
            if name == BUILTIN_NAME:
                return bundle
            break
    log(f'  warn: no {BUILTIN_NAME} bundle (materials of its renderers are skipped)')
    return None


def find_stage_scene(stage_id, ab_root):
    """The stage's scene bundle under `ab_root`, or None. scenes.scene_bundle gives the path beside the theme's other
    levels; a DLC stage whose scene ships in a `dlc<N>` subdirectory of the theme (ro5/dlc1/level_rogue5_sv-1_dlc1)
    is found there as a fallback."""
    src = scenes.find_scene(stage_id, [ab_root])
    if src is not None:
        return src
    rel = Path(scenes.scene_bundle(stage_id))
    theme_dir = Path(ab_root) / rel.parent.parent
    for sub in sorted(theme_dir.glob('dlc*')):
        candidate = sub / rel.parent.name / rel.name
        if candidate.is_file():
            return candidate
    return None


def load_manifest(path, log):
    """The local-assets document at `path` (an empty one when the file does not exist yet), or None on a bad file."""
    path = Path(path)
    if not path.is_file():
        return {'version': 1, 'source': 'local-client', 'count': 0, 'groups': {}}
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        log(f'FAIL read {path}: {e}')
        return None


def merge_into(doc, group, entries, merge=False):
    """Add one group to a loaded manifest document (replacing it, or merging into it when `merge`) and set count to
    the sum of every group's entries. Other groups are kept as they are. Returns (entries in the group, count)."""
    groups = doc.setdefault('groups', {})
    if merge:
        groups.setdefault(group, {}).update(entries)
    else:
        groups[group] = entries
    doc['count'] = sum(len(v) for v in groups.values())
    return len(groups[group]), doc['count']


def save_manifest(path, doc, log):
    """Write a loaded manifest document back (compact JSON, the layout the repository's copies have)."""
    path = Path(path)
    try:
        path.write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    except OSError as e:
        log(f'FAIL write {path}: {e}')
        return False
    return True


def install(src_dir, out_root, sub, log, quiet=False):
    """Copy the files of `src_dir` into <out>/<sub>/ that are not already there byte for byte. Returns the
    destination, the file names in `src_dir` and the names written."""
    dest = Path(out_root) / sub
    dest.mkdir(parents=True, exist_ok=True)
    names, written = [], []
    for src in sorted(src_dir.iterdir()):
        if not src.is_file():
            continue
        names.append(src.name)
        target = dest / src.name
        if target.is_file() and target.stat().st_size == src.stat().st_size and filecmp.cmp(src, target, shallow=False):
            continue
        shutil.copyfile(src, target)
        written.append(src.name)
    if not quiet:
        log(f'{dest.as_posix()}: ' + ', '.join(names))
    return dest, names, written


def cab_index(ab_root, log):
    """{lower-case CAB name → bundle path relative to `ab_root`} for the bundles a scene can depend on.

    A scene bundle lists its dependencies by the CAB-<hash> name of the dependency's serialized file, not by path, so
    the paths are recovered by reading the CAB names inside the client's art bundles once per run. Scanned roots:
    arts/**, shaders/**, the anon/ data bundles and the bundles at the AB root itself. Bundles sharing one CAB name
    (identical content) resolve to the first in path order."""
    import aklz4  # noqa: F401  (registers the LZ4AK decoder)
    import UnityPy
    root = Path(ab_root)
    bundles = [p for d in ('arts', 'shaders') if (root / d).is_dir() for p in (root / d).rglob('*.ab')]
    bundles += list((root / 'anon').glob('*.bin')) + list(root.glob('*.ab'))
    index = {}
    for bundle in sorted(bundles):
        try:
            env = UnityPy.load(str(bundle))
        except Exception:  # not a bundle this UnityPy reads
            continue
        for f in env.files.values():
            for cab in getattr(f, 'files', None) or {}:
                if cab.upper().startswith('CAB-'):
                    index.setdefault(cab.lower(), bundle.relative_to(root).as_posix())
    log(f'CAB index: {len(index)} dependency names from {len(bundles)} bundles')
    return index


def scene_deps(src, index, log):
    """(dependency bundle paths the scene bundle `src` lists, number of names `index` does not know). Unresolved names
    are expected: a scene depends on bundles of other modes too (effects / shaders it does not read here)."""
    import aklz4  # noqa: F401
    import UnityPy
    try:
        env = UnityPy.load(str(src))
    except Exception as e:
        log(f'  warn {Path(src).name}: dependency list unavailable: {e}')
        return [], 0
    names = []
    for o in env.objects:
        if o.type.name != 'AssetBundle':
            continue
        try:
            names = o.read_typetree().get('m_Dependencies') or []
        except Exception:
            names = []
        break
    deps, unresolved = [], 0
    for name in names:
        rel = index.get(name.lower())
        if rel is None:
            unresolved += 1
        elif rel not in deps:
            deps.append(rel)
    return deps, unresolved


def theme_stages(stages_path, theme, log):
    """Sorted ids of the active `rogue_<theme>_*` stages of the stage table (empty on a bad file)."""
    path = Path(stages_path)
    try:
        doc = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as e:
        log(f'FAIL read {path}: {e}')
        return []
    prefix = f'rogue_{theme}_'
    return sorted(k for k, v in doc.items() if k.startswith(prefix) and (v or {}).get('active'))


def known_textures(docs, out_root):
    """The scene/tex entries the manifests already list whose file is on disk: export_scene then neither encodes those
    textures again nor lists them twice."""
    known = {}
    for _path, doc in docs:
        for name, rec in (doc.get('groups', {}).get(scenes.TEX_SUB) or {}).items():
            if name in known:
                continue
            rel = str(rec.get('path', '')).split('/assets/local/', 1)[-1]
            if rel and (Path(out_root) / rel).is_file():
                known[name] = rec
    return known


def export_one(stage_id, deps, src, ab_root, out_root, docs, tex_known, log, keep_stage=False):
    """Extract one stage into a temporary directory, install it under <out>/scene/<stageId>/ (+ only the textures not
    already under <out>/scene/tex/) and merge its groups into the loaded manifests `docs` ([(path, doc)]).

    Returns (status, scene file names, files written, new texture entries, scene.json document); status is 'new' when
    files were written, 'skipped' when every destination file already had the same bytes, or 'failed'."""
    stage_dir = Path(tempfile.mkdtemp(prefix=f'scene-{stage_id}-', dir=tempfile.gettempdir()))
    try:
        manifest = {scenes.TEX_SUB: dict(tex_known)}
        n = scenes.export_scene(stage_id, deps, src, ab_root, stage_dir, manifest, log, extract.material_info,
                               extract.dep_bundles(ab_root, {'Material'}))
        group = f'{scenes.SCENE_SUB}/{stage_id}'
        entries = manifest.get(group) or {}
        staged = stage_dir / scenes.SCENE_SUB / stage_id
        if not n or not entries or not staged.is_dir():
            log(f'FAIL {stage_id}: nothing extracted ({n} files, {len(entries)} manifest entries)')
            return 'failed', [], [], {}, None
        dest, names, written = install(staged, out_root, group, log, quiet=True)
        for key, rec in entries.items():  # the manifest must only list files this run installed
            if Path(rec['path']).name not in names:
                log(f'FAIL {stage_id}: {key} lists {rec["path"]}, which was not installed')
                return 'failed', names, [], {}, None
        textures = {k: v for k, v in (manifest.get(scenes.TEX_SUB) or {}).items() if k not in tex_known}
        tex_written = []
        if textures:
            staged_tex = stage_dir / scenes.TEX_SUB
            if not staged_tex.is_dir():
                log(f'FAIL {stage_id}: {len(textures)} texture entries but no staged {staged_tex.as_posix()}')
                return 'failed', names, written, {}, None
            _, tex_names, tex_written = install(staged_tex, out_root, scenes.TEX_SUB, log, quiet=True)
            for key, rec in textures.items():  # same rule as the scene files: the manifest lists only installed files
                if Path(rec['path']).name not in tex_names:
                    log(f'FAIL {stage_id}: texture {key} lists {rec["path"]}, which was not installed')
                    return 'failed', names, written, {}, None
        for _path, doc_ in docs:
            merge_into(doc_, group, entries)
            if textures:
                merge_into(doc_, scenes.TEX_SUB, textures, merge=True)
        doc = json.loads((staged / 'scene.json').read_text(encoding='utf-8'))
        log(f'  {stage_id} → {dest.as_posix()}: {len(doc["chunks"])} chunks, '
            f'{sum(c["verts"] for c in doc["chunks"])} vertices, {doc["lightmaps"]} lightmap page(s); '
            f'{len(written)}/{len(names)} scene file(s) written, '
            f'{len(textures)} new texture(s) ({len(tex_written)} written)')
        return ('new' if written or tex_written else 'skipped'), names, written, textures, doc
    except Exception as e:  # one bad stage must not stop the batch
        log(f'FAIL {stage_id}: {type(e).__name__}: {e}')
        return 'failed', [], [], {}, None
    finally:
        if keep_stage:
            log(f'staging kept: {stage_dir.as_posix()}')
        else:
            shutil.rmtree(stage_dir, ignore_errors=True)


def batch(ab_root, stage_ids, out_root, manifest_paths, log, keep_stage=False):
    """Extract every stage of `stage_ids`, merging each `scene/<stageId>` group into every manifest of
    `manifest_paths` (saved after each stage). Returns 0 when every stage was extracted or already up to date."""
    docs = []
    for path in manifest_paths:
        doc = load_manifest(path, log)
        if doc is None:
            return 1
        docs.append((Path(path), doc))
    index = cab_index(ab_root, log)
    builtin = find_builtin(ab_root, log)
    builtin_rel = builtin.relative_to(ab_root).as_posix() if builtin else None
    counts = {'new': 0, 'skipped': 0, 'failed': 0}
    failed = []
    scene_bytes = new_bytes = 0
    total = len(stage_ids)
    for i, stage_id in enumerate(stage_ids, 1):
        src = find_stage_scene(stage_id, ab_root)
        if src is None:
            log(f'[{i}/{total}] {stage_id}: FAIL no scene bundle {scenes.scene_bundle(stage_id)}')
            counts['failed'] += 1
            failed.append((stage_id, 'no scene bundle'))
            continue
        deps, unresolved = scene_deps(src, index, log)
        deps = list(deps)
        for rel in ROGUE_DEPS.get(stage_id, ()):  # the pinned theme bundles win over a resolution gap
            if rel not in deps:
                deps.append(rel)
        if builtin_rel and builtin_rel not in deps:
            deps = [*deps, builtin_rel]
        log(f'[{i}/{total}] {stage_id}: {len(deps)} dep bundle(s), {unresolved} unresolved name(s)')
        status, names, written, textures, doc = export_one(
            stage_id, deps, src, ab_root, out_root, docs, known_textures(docs, out_root), log, keep_stage)
        counts[status] += 1
        if status == 'failed':
            failed.append((stage_id, 'export failed'))
            continue
        stage_out = Path(out_root) / scenes.SCENE_SUB / stage_id
        scene_bytes += sum((stage_out / name).stat().st_size for name in names)
        new_bytes += sum((stage_out / name).stat().st_size for name in written)
        for path, doc_ in docs:
            if not save_manifest(path, doc_, log):
                return 1
    log(f'batch: {counts["new"]} new, {counts["skipped"]} up to date, {counts["failed"]} failed '
        f'of {total} stage(s)')
    log(f'batch: scene files {scene_bytes / 2 ** 20:.1f} MiB total, {new_bytes / 2 ** 20:.1f} MiB written this run')
    for path, doc_ in docs:
        log(f'{path.as_posix()}: count {doc_["count"]}, {len(doc_["groups"])} groups, '
            f'{len(doc_["groups"].get(scenes.TEX_SUB, {}))} scene/tex entries')
    for stage_id, why in failed:
        log(f'FAIL {stage_id}: {why}')
    return 1 if counts['failed'] else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--game', help='install directory or AssetBundle root (…/AB/Windows)')
    ap.add_argument('--stage', action='append', metavar='ID',
                    help='roguelike stage id (default rogue_ro4_1-1; ignored with --theme). Repeatable: several ids '
                         'are extracted as one batch, which resumes an interrupted --theme run')
    ap.add_argument('--theme', metavar='RO[,RO...]',
                    help='every active rogue_<RO>_* stage of the stage table, e.g. ro4 or ro1,ro2,ro3,ro5,ro6')
    ap.add_argument('--stages', default=str(ROOT / STAGES), help='stage table for --theme (default data/stages.json)')
    ap.add_argument('--out', default=str(ROOT / 'public/assets/local'), help='output root (default public/assets/local)')
    ap.add_argument('--manifest', action='append', default=[], metavar='JSON',
                    help='local-assets.json to merge the group into (repeatable; default: both copies in the repository)')
    ap.add_argument('--keep-stage', action='store_true', help='keep the temporary staging directory')
    args = ap.parse_args()

    ab_root = extract.locate_client(args.game)
    if not ab_root or not Path(ab_root).exists():
        print('No Arknights install found. Pass --game <install directory or AssetBundle root>.', file=sys.stderr)
        return 2
    ab_root = Path(ab_root)
    manifests = [Path(p) for p in (args.manifest or [str(ROOT / rel) for rel in MANIFESTS])]

    if args.theme:  # every active stage of the theme(s), one scene/<stageId> group each
        themes = [t for t in re.split(r'[,\s]+', args.theme.strip()) if t]
        print(f'AB root: {ab_root}')
        stage_ids, empty = [], []
        for theme in themes:
            ids = theme_stages(args.stages, theme, print)
            print(f'theme {theme}: {len(ids)} active stage(s) of {Path(args.stages).as_posix()}')
            if ids:
                stage_ids.extend(ids)
            else:
                empty.append(theme)
        for theme in empty:
            print(f'warn: {theme}: no active rogue_{theme}_* stage', file=sys.stderr)
        if not stage_ids:
            print(f'{args.theme}: no active rogue_<theme>_* stage in {Path(args.stages).as_posix()}',
                  file=sys.stderr)
            return 2
        return batch(ab_root, sorted(stage_ids), args.out, manifests, print, args.keep_stage)

    stage_id = (args.stage or ['rogue_ro4_1-1'])[0]
    if args.stage and len(args.stage) > 1:  # several named stages: the same batch path, one CAB index
        print(f'AB root: {ab_root}')
        print(f'{len(set(args.stage))} named stage(s)')
        return batch(ab_root, sorted(set(args.stage)), args.out, manifests, print, args.keep_stage)
    src = find_stage_scene(stage_id, ab_root)
    if src is None:
        print(f'skip (no scene bundle) {scenes.scene_bundle(stage_id)}', file=sys.stderr)
        return 1
    deps = list(ROGUE_DEPS.get(stage_id, ()))
    if not deps:  # not pinned: the dependency list of the stage's own scene bundle
        deps, unresolved = scene_deps(src, cab_index(ab_root, print), print)
        print(f'deps from the scene bundle: {len(deps)} resolved, {unresolved} unresolved name(s)')
    builtin = find_builtin(ab_root, print)
    if builtin:  # export_scene resolves relative dependencies against the AB root; an absolute path works too
        try:
            deps = [*deps, builtin.relative_to(ab_root).as_posix()]
        except ValueError:
            deps = [*deps, str(builtin)]
    print(f'AB root: {ab_root}')
    print(f'scene: {scenes.scene_bundle(stage_id)}')
    print(f'deps: {", ".join(deps)}')

    docs = []
    for path in manifests:
        doc = load_manifest(path, print)
        if doc is None:
            return 1
        docs.append((Path(path), doc))
    status, names, written, textures, doc = export_one(stage_id, deps, src, ab_root, args.out, docs,
                                                       known_textures(docs, args.out), print, args.keep_stage)
    if status == 'failed' or doc is None:
        return 1
    if not all([save_manifest(path, d, print) for path, d in docs]):
        return 1
    print(f'done: {stage_id} ({status}): {len(doc["chunks"])} chunks, '
          f'{sum(c["verts"] for c in doc["chunks"])} vertices, {sum(c["tris"] for c in doc["chunks"])} triangles, '
          f'{doc["lightmaps"]} lightmap page(s), {len(names)} files ({len(written)} written); '
          f'{scenes.TEX_SUB}: {len(textures)} new entries, {len(docs)} manifest(s) updated')
    return 0


if __name__ == '__main__':
    sys.exit(main())
