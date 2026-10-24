using System.IO;
using UnityEditor;
using UnityEngine;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// Finds a transferred texture by the path GameBridge gave it. A texture that is on disk but not
	/// yet known to the asset database is imported on the spot, so a material never misses a texture
	/// that arrived in the same refresh.
	/// </summary>
	public static class GameBridgeTextureLoader
	{
		/// <summary>PNG first; Unreal falls back to the others for HDR and high bit-depth textures.</summary>
		private static readonly string[] Extensions = { ".png", ".tga", ".exr", ".hdr" };

		/// <summary>The file the texture was transferred as, or null if it never arrived.</summary>
		public static string FilePath(string root, string texture)
		{
			if (string.IsNullOrEmpty(texture))
			{
				return null;
			}

			foreach (var extension in Extensions)
			{
				var path = root + "/" + texture + extension;
				if (File.Exists(path))
				{
					return path;
				}
			}

			return null;
		}

		public static Texture2D Load(string root, string texture)
		{
			var path = FilePath(root, texture);
			if (path == null || !File.Exists(path))
			{
				return null;
			}

			var loaded = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
			if (loaded != null)
			{
				return loaded;
			}

			AssetDatabase.ImportAsset(path);
			return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
		}

		/// <summary>Loads a normal map, making sure it is imported as one whatever its name suggested.</summary>
		public static Texture2D LoadNormal(string root, string texture)
		{
			var loaded = Load(root, texture);
			if (loaded == null)
			{
				return null;
			}

			var path = AssetDatabase.GetAssetPath(loaded);
			var importer = (TextureImporter)AssetImporter.GetAtPath(path);
			if (importer.textureType != TextureImporterType.NormalMap)
			{
				importer.textureType = TextureImporterType.NormalMap;
				importer.SaveAndReimport();
			}

			return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
		}
	}
}
