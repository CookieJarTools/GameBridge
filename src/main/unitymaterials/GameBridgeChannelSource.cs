using System.IO;
using UnityEngine;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// A texture read straight from its PNG so its pixels can be sampled, whatever its import
	/// settings say. Reading the file avoids switching the asset to read/write just to repack it.
	/// </summary>
	public sealed class GameBridgeChannelSource
	{
		private readonly Color32[] pixels;

		public int Width { get; }
		public int Height { get; }

		private GameBridgeChannelSource(Texture2D texture)
		{
			Width = texture.width;
			Height = texture.height;
			pixels = texture.GetPixels32();
		}

		public static GameBridgeChannelSource Read(string file)
		{
			if (string.IsNullOrEmpty(file) || !File.Exists(file))
			{
				return null;
			}

			var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
			var source = texture.LoadImage(File.ReadAllBytes(file)) ? new GameBridgeChannelSource(texture) : null;
			Object.DestroyImmediate(texture);
			return source;
		}

		/// <summary>One channel at a point in the output, scaled by nearest pixel when sizes differ.</summary>
		public float Sample(int x, int y, int outWidth, int outHeight, int channel)
		{
			var sx = outWidth == Width ? x : x * Width / outWidth;
			var sy = outHeight == Height ? y : y * Height / outHeight;
			var pixel = pixels[sy * Width + sx];
			return pixel[channel] / 255f;
		}
	}
}
