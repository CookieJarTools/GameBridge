# Run by GameBridge inside UnrealEditor-Cmd (-run=pythonscript).
# Exports the assets listed in the job file to FBX / WAV / PNG. One line per
# asset is printed with a GAMEBRIDGE| prefix so the launcher can follow along.
import json
import os

import unreal

PREFIX = "GAMEBRIDGE|"


def report(**fields):
    print(PREFIX + json.dumps(fields), flush=True)


def fbx_options(kind):
    opts = unreal.FbxExportOption()
    opts.ascii = False
    opts.collision = False
    opts.level_of_detail = False
    opts.vertex_color = True
    opts.export_morph_targets = True
    # Animations carry their own skeleton; the mesh comes across separately.
    opts.export_preview_mesh = False
    try:
        opts.fbx_export_compatibility = unreal.FbxExportCompatibility.FBX_2020
    except AttributeError:
        pass
    return opts


def export(asset):
    obj = unreal.load_asset(asset["objectPath"])
    if obj is None:
        return "Couldn't load the asset"

    out = asset["out"]
    os.makedirs(os.path.dirname(out), exist_ok=True)

    task = unreal.AssetExportTask()
    task.object = obj
    task.filename = out
    task.automated = True
    task.prompt = False
    task.replace_identical = True
    if out.lower().endswith(".fbx"):
        task.options = fbx_options(asset["kind"])

    if not unreal.Exporter.run_asset_export_task(task):
        return "Unreal's exporter refused it"
    if not os.path.exists(out):
        return "Unreal reported success but wrote no file"
    return None


def main():
    with open(os.environ["GAMEBRIDGE_JOB"], encoding="utf-8") as f:
        job = json.load(f)

    assets = job["assets"]
    report(event="start", total=len(assets))
    for i, asset in enumerate(assets):
        try:
            error = export(asset)
        except Exception as e:  # keep going; one bad asset shouldn't stop the batch
            error = str(e)
        report(event="asset", index=i, objectPath=asset["objectPath"], ok=error is None, error=error)
    report(event="done")


main()
