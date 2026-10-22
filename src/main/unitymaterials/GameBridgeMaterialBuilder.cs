using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// Builds Unity materials for assets GameBridge transferred from Unreal, then removes itself.
	///
	/// GameBridge drops this script and a manifest into the project. It runs the next time Unity
	/// compiles scripts, whether the editor was already open or opens later, so nobody has to close
	/// Unity for a transfer. It only ever deletes its own folder, and the folders above it when they
	/// are left empty.
	/// </summary>
	[InitializeOnLoad]
	public static class GameBridgeMaterialBuilder
	{
		private const string Folder = "Assets/GameBridge/Editor/Materials";
		private const string PendingFolder = Folder + "/Pending";
		private const string EditorFolder = "Assets/GameBridge/Editor";
		private const string RootFolder = "Assets/GameBridge";

		static GameBridgeMaterialBuilder()
		{
			// Headless builds load editor scripts too, and editing assets in the middle of one would be a surprise.
			if (Application.isBatchMode)
			{
				return;
			}

			EditorApplication.delayCall += Run;
		}

		/// <summary>Builds every pending manifest. Public so a batch-mode run can call it with -executeMethod.</summary>
		public static void Run()
		{
			if (Directory.Exists(PendingFolder))
			{
				foreach (var file in Directory.GetFiles(PendingFolder, "*.json"))
				{
					Build(file.Replace('\\', '/'));
				}
			}

			RemoveSelf();
		}

		private static void Build(string file)
		{
			try
			{
				BuildFrom(JsonUtility.FromJson<GameBridgeMaterialManifest>(File.ReadAllText(file)));
			}
			catch (Exception e)
			{
				Debug.LogError("GameBridge could not build the materials in " + file + ": " + e.Message);
			}

			AssetDatabase.DeleteAsset(file);
		}

		private static void BuildFrom(GameBridgeMaterialManifest manifest)
		{
			var pipeline = GameBridgePipelines.Current();
			var shader = GameBridgePipelines.LitShader(pipeline);
			if (shader == null)
			{
				throw new InvalidOperationException("the Lit shader for the " + pipeline + " pipeline was not found");
			}

			GameBridgeMaskPacker.Reset();
			var materials = manifest.materials ?? Array.Empty<GameBridgeMaterialSpec>();
			foreach (var spec in materials)
			{
				BuildMaterial(manifest.root, spec, pipeline, shader);
			}

			AssetDatabase.SaveAssets();
			foreach (var mesh in manifest.meshes ?? Array.Empty<GameBridgeMeshSpec>())
			{
				Remap(manifest.root, mesh);
			}

			Debug.Log("GameBridge built " + materials.Length + " materials in " + manifest.root + " for the " + pipeline + " pipeline.");
		}

		private static void BuildMaterial(string root, GameBridgeMaterialSpec spec, GameBridgePipeline pipeline, Shader shader)
		{
			var path = root + "/" + spec.path + ".mat";
			var material = AssetDatabase.LoadAssetAtPath<Material>(path);
			if (material == null)
			{
				material = new Material(shader);
				CreateFolder(Path.GetDirectoryName(path));
				AssetDatabase.CreateAsset(material, path);
			}

			material.shader = shader;
			var textures = new GameBridgeMaterialTextures
			{
				BaseMap = GameBridgeTextureLoader.Load(root, spec.baseMap),
				NormalMap = GameBridgeTextureLoader.LoadNormal(root, spec.normalMap),
				MaskMap = GameBridgeMaskPacker.Build(root, spec),
				EmissionMap = GameBridgeTextureLoader.Load(root, spec.emissionMap)
			};
			Apply(material, spec, textures, pipeline);
			EditorUtility.SetDirty(material);
		}

		private static void Apply(Material material, GameBridgeMaterialSpec spec, GameBridgeMaterialTextures textures, GameBridgePipeline pipeline)
		{
			switch (pipeline)
			{
				case GameBridgePipeline.Universal:
					GameBridgeUniversalLit.Apply(material, spec, textures);
					break;
				case GameBridgePipeline.HighDefinition:
					GameBridgeHighDefinitionLit.Apply(material, spec, textures);
					break;
				default:
					GameBridgeBuiltInLit.Apply(material, spec, textures);
					break;
			}
		}

		/// <summary>
		/// Points each of the model's material slots at the rebuilt material. The FBX names its materials
		/// after the Unreal material assets, which is what the slot names here are.
		/// </summary>
		private static void Remap(string root, GameBridgeMeshSpec mesh)
		{
			if (!(AssetImporter.GetAtPath(root + "/" + mesh.path + ".fbx") is ModelImporter importer))
			{
				return;
			}

			var changed = false;
			foreach (var slot in mesh.slots ?? Array.Empty<GameBridgeSlotSpec>())
			{
				var material = AssetDatabase.LoadAssetAtPath<Material>(root + "/" + slot.material + ".mat");
				if (material != null)
				{
					importer.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material), slot.name), material);
					changed = true;
				}
			}

			if (changed)
			{
				importer.SaveAndReimport();
			}
		}

		private static void CreateFolder(string folder)
		{
			folder = folder.Replace('\\', '/');
			if (AssetDatabase.IsValidFolder(folder))
			{
				return;
			}

			var parent = Path.GetDirectoryName(folder).Replace('\\', '/');
			CreateFolder(parent);
			AssetDatabase.CreateFolder(parent, Path.GetFileName(folder));
		}

		/// <summary>
		/// Deletes this script's folder once nothing is pending, then the folders above it if they are
		/// empty. GameBridge's build script can live alongside in Assets/GameBridge/Editor, so those are
		/// never removed while anything else is in them.
		/// </summary>
		private static void RemoveSelf()
		{
			if (Directory.Exists(PendingFolder) && Directory.GetFiles(PendingFolder, "*.json").Length > 0)
			{
				return;
			}

			AssetDatabase.DeleteAsset(Folder);
			DeleteIfEmpty(EditorFolder);
			DeleteIfEmpty(RootFolder);
		}

		private static void DeleteIfEmpty(string folder)
		{
			if (Directory.Exists(folder) && Directory.GetFileSystemEntries(folder).Length == 0)
			{
				AssetDatabase.DeleteAsset(folder);
			}
		}
	}
}
