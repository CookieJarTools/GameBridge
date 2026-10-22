# Run by GameBridge inside UnrealEditor-Cmd (-run=pythonscript).
# Exports the assets listed in the job file to FBX / WAV / PNG, and describes
# materials as JSON so Unity can rebuild them. One line per asset is printed
# with a GAMEBRIDGE| prefix so the launcher can follow along.
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


def package_of(obj):
    return obj.get_path_name().split(".")[0]


def blend_name(material, instance):
    blend = material.get_editor_property("blend_mode")
    # A material instance can override its parent's blend mode.
    if instance is not None:
        try:
            overrides = instance.get_editor_property("base_property_overrides")
            if overrides.get_editor_property("override_blend_mode"):
                blend = overrides.get_editor_property("blend_mode")
        except Exception:
            pass
    return str(blend).split(".")[-1].split(":")[0].replace("BLEND_", "").lower()


def used_textures(material):
    mel = unreal.MaterialEditingLibrary
    for name in ("get_material_used_textures", "get_used_textures"):
        fn = getattr(mel, name, None)
        if fn is None:
            continue
        try:
            return list(fn(material))
        except Exception:
            continue
    return []


def describe_material(obj):
    mel = unreal.MaterialEditingLibrary
    instance = obj if isinstance(obj, unreal.MaterialInstance) else None
    base = obj.get_base_material() if instance else obj

    def value(kind, name):
        if instance:
            return getattr(mel, "get_material_instance_%s_parameter_value" % kind)(obj, name)
        return getattr(mel, "get_material_default_%s_parameter_value" % kind)(obj, name)

    textures, seen = [], set()
    for name in mel.get_texture_parameter_names(obj):
        tex = value("texture", name)
        if tex:
            textures.append({"param": str(name), "path": package_of(tex)})
            seen.add(package_of(tex))
    # Textures wired straight into the graph, not through a parameter.
    for tex in used_textures(base):
        if tex and package_of(tex) not in seen:
            textures.append({"param": "", "path": package_of(tex)})
            seen.add(package_of(tex))

    scalars = [{"name": str(n), "value": float(value("scalar", n))} for n in mel.get_scalar_parameter_names(obj)]
    vectors = []
    for n in mel.get_vector_parameter_names(obj):
        c = value("vector", n)
        vectors.append({"name": str(n), "value": [c.r, c.g, c.b, c.a]})

    return {
        "blend": blend_name(base, instance),
        "twoSided": bool(base.get_editor_property("two_sided")),
        "cutoff": float(base.get_editor_property("opacity_mask_clip_value")),
        "textures": textures,
        "scalars": scalars,
        "vectors": vectors,
    }


def mesh_slots(obj):
    if isinstance(obj, unreal.StaticMesh):
        entries = obj.get_editor_property("static_materials")
    elif isinstance(obj, unreal.SkeletalMesh):
        entries = obj.get_editor_property("materials")
    else:
        return None
    slots = []
    for entry in entries:
        material = entry.get_editor_property("material_interface")
        slots.append({
            "slot": str(entry.get_editor_property("material_slot_name")),
            "material": package_of(material) if material else "",
        })
    return slots


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def export(asset):
    obj = unreal.load_asset(asset["objectPath"])
    if obj is None:
        return "Couldn't load the asset"

    out = asset["out"]
    os.makedirs(os.path.dirname(out), exist_ok=True)

    if asset["kind"] == "material":
        write_json(out, describe_material(obj))
        return None

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

    # Which material each slot uses, so Unity can hook the rebuilt materials up.
    slots = mesh_slots(obj)
    if slots is not None:
        write_json(out + ".slots.json", slots)
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
