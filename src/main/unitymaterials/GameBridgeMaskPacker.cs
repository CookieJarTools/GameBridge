using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// Repacks Unreal's metallic, roughness and occlusion into the one mask texture Unity's Lit shaders
	/// read: metallic in red, occlusion in green and smoothness, which is one minus roughness, in alpha.
	/// Unreal packs these in several orders (ORM, MRA and others), so GameBridge sends the channel each
	/// one lives in.
	/// </summary>
	public static class GameBridgeMaskPacker
	{
		private const string SharedSuffix = "_UnityMask";
		private const string OwnSuffix = "_Mask";

		private static readonly Dictionary<string, Texture2D> packed = new Dictionary<string, Texture2D>();

		/// <summary>Forgets masks packed for an earlier manifest.</summary>
		public static void Reset()
		{
			packed.Clear();
		}

		public static Texture2D Build(string root, GameBridgeMaterialSpec spec)
		{
			if (spec.metallicChannel < 0 && spec.roughnessChannel < 0 && spec.occlusionChannel < 0)
			{
				return null;
			}

			var output = OutputPath(root, spec);
			if (packed.TryGetValue(output, out var done))
			{
				return done;
			}

			var mask = Pack(root, spec, output);
			packed[output] = mask;
			return mask;
		}

		private static Texture2D Pack(string root, GameBridgeMaterialSpec spec, string output)
		{
			var metal = GameBridgeChannelSource.Read(GameBridgeTextureLoader.FilePath(root, spec.metallicMap));
			var rough = GameBridgeChannelSource.Read(GameBridgeTextureLoader.FilePath(root, spec.roughnessMap));
			var occlusion = GameBridgeChannelSource.Read(GameBridgeTextureLoader.FilePath(root, spec.occlusionMap));
			var width = Largest(metal, rough, occlusion, true);
			var height = Largest(metal, rough, occlusion, false);
			if (width == 0)
			{
				return null;
			}

			var pixels = new Color[width * height];
			for (var y = 0; y < height; y++)
			{
				for (var x = 0; x < width; x++)
				{
					var m = Value(metal, spec.metallicChannel, x, y, width, height, spec.metallic);
					var ao = Value(occlusion, spec.occlusionChannel, x, y, width, height, 1f);
					var r = Value(rough, spec.roughnessChannel, x, y, width, height, spec.roughness);
					pixels[y * width + x] = new Color(m, ao, 0f, 1f - r);
				}
			}

			Write(output, pixels, width, height);
			return AssetDatabase.LoadAssetAtPath<Texture2D>(output);
		}

		private static float Value(GameBridgeChannelSource source, int channel, int x, int y, int width, int height, float fallback)
		{
			return source == null || channel < 0 ? fallback : source.Sample(x, y, width, height, channel);
		}

		private static int Largest(GameBridgeChannelSource a, GameBridgeChannelSource b, GameBridgeChannelSource c, bool across)
		{
			var most = 0;
			foreach (var source in new[] { a, b, c })
			{
				if (source != null)
				{
					most = Mathf.Max(most, across ? source.Width : source.Height);
				}
			}

			return most;
		}

		/// <summary>
		/// Material instances usually share one packed texture, so a mask made from a single texture is
		/// named after it and built once. A mask pulled from several textures belongs to its material.
		/// </summary>
		private static string OutputPath(string root, GameBridgeMaterialSpec spec)
		{
			var single = spec.metallicMap == spec.roughnessMap && spec.roughnessMap == spec.occlusionMap;
			return single
				? root + "/" + spec.metallicMap + SharedSuffix + ".png"
				: root + "/" + spec.path + OwnSuffix + ".png";
		}

		private static void Write(string path, Color[] pixels, int width, int height)
		{
			var texture = new Texture2D(width, height, TextureFormat.RGBA32, false, true);
			texture.SetPixels(pixels);
			Directory.CreateDirectory(Path.GetDirectoryName(path));
			File.WriteAllBytes(path, texture.EncodeToPNG());
			Object.DestroyImmediate(texture);

			AssetDatabase.ImportAsset(path);
			var importer = (TextureImporter)AssetImporter.GetAtPath(path);
			importer.sRGBTexture = false;
			importer.SaveAndReimport();
		}
	}
}
