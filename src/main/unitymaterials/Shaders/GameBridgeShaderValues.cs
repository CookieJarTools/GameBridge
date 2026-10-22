using UnityEngine;

namespace GameBridgeGenerated.Materials
{
	/// <summary>Small helpers the three shader setups share.</summary>
	public static class GameBridgeShaderValues
	{
		public static Color Tint(GameBridgeMaterialSpec spec)
		{
			var t = spec.tint;
			return t != null && t.Length == 4 ? new Color(t[0], t[1], t[2], t[3]) : Color.white;
		}

		public static bool Transparent(GameBridgeMaterialSpec spec)
		{
			return spec.blend == "transparent" || spec.blend == "additive";
		}

		public static void Keyword(Material material, string keyword, bool on)
		{
			if (on)
			{
				material.EnableKeyword(keyword);
				return;
			}

			material.DisableKeyword(keyword);
		}
	}
}
