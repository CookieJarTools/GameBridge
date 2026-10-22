using UnityEngine;
using UnityEngine.Rendering;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// Fills in the built-in pipeline's Standard shader, setting the same keywords and blend state its
	/// inspector would. Standard has no two-sided option, so that setting is left behind.
	/// </summary>
	public static class GameBridgeBuiltInLit
	{
		private const float CutoutMode = 1f;
		private const float TransparentMode = 3f;

		public static void Apply(Material material, GameBridgeMaterialSpec spec, GameBridgeMaterialTextures textures)
		{
			material.SetTexture("_MainTex", textures.BaseMap);
			material.SetColor("_Color", GameBridgeShaderValues.Tint(spec));

			material.SetTexture("_BumpMap", textures.NormalMap);
			GameBridgeShaderValues.Keyword(material, "_NORMALMAP", textures.NormalMap != null);

			var mask = textures.MaskMap;
			material.SetTexture("_MetallicGlossMap", mask);
			material.SetTexture("_OcclusionMap", mask);
			GameBridgeShaderValues.Keyword(material, "_METALLICGLOSSMAP", mask != null);
			material.SetFloat("_GlossMapScale", 1f);
			material.SetFloat("_Metallic", spec.metallic);
			material.SetFloat("_Glossiness", 1f - spec.roughness);

			var emission = textures.EmissionMap;
			material.SetTexture("_EmissionMap", emission);
			material.SetColor("_EmissionColor", emission != null ? Color.white * spec.emission : Color.black);
			GameBridgeShaderValues.Keyword(material, "_EMISSION", emission != null);

			ApplyBlend(material, spec);
		}

		private static void ApplyBlend(Material material, GameBridgeMaterialSpec spec)
		{
			var clip = spec.blend == "masked";
			var transparent = GameBridgeShaderValues.Transparent(spec);
			material.SetFloat("_Cutoff", spec.cutoff);
			GameBridgeShaderValues.Keyword(material, "_ALPHATEST_ON", clip);
			GameBridgeShaderValues.Keyword(material, "_ALPHAPREMULTIPLY_ON", transparent);

			if (!transparent)
			{
				material.SetFloat("_Mode", clip ? CutoutMode : 0f);
				material.SetFloat("_SrcBlend", (float)BlendMode.One);
				material.SetFloat("_DstBlend", (float)BlendMode.Zero);
				material.SetFloat("_ZWrite", 1f);
				material.SetOverrideTag("RenderType", clip ? "TransparentCutout" : "Opaque");
				material.renderQueue = clip ? (int)RenderQueue.AlphaTest : -1;
				return;
			}

			material.SetFloat("_Mode", TransparentMode);
			material.SetFloat("_SrcBlend", (float)BlendMode.One);
			material.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
			material.SetFloat("_ZWrite", 0f);
			material.SetOverrideTag("RenderType", "Transparent");
			material.renderQueue = (int)RenderQueue.Transparent;
		}
	}
}
