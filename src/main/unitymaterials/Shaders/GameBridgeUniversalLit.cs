using UnityEngine;
using UnityEngine.Rendering;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// Fills in URP's Lit shader. Keywords are switched on by hand because URP only works them out
	/// itself when a material is opened in the inspector, and a texture without its keyword is ignored.
	/// </summary>
	public static class GameBridgeUniversalLit
	{
		public static void Apply(Material material, GameBridgeMaterialSpec spec, GameBridgeMaterialTextures textures)
		{
			material.SetTexture("_BaseMap", textures.BaseMap);
			material.SetColor("_BaseColor", GameBridgeShaderValues.Tint(spec));
			ApplyNormal(material, textures.NormalMap);
			ApplySurface(material, spec, textures.MaskMap);
			ApplyEmission(material, spec, textures.EmissionMap);
			ApplyBlend(material, spec);
			material.SetFloat("_Cull", spec.twoSided ? (float)CullMode.Off : (float)CullMode.Back);
		}

		private static void ApplyNormal(Material material, Texture2D normal)
		{
			material.SetTexture("_BumpMap", normal);
			GameBridgeShaderValues.Keyword(material, "_NORMALMAP", normal != null);
		}

		private static void ApplySurface(Material material, GameBridgeMaterialSpec spec, Texture2D mask)
		{
			material.SetTexture("_MetallicGlossMap", mask);
			material.SetTexture("_OcclusionMap", mask);
			GameBridgeShaderValues.Keyword(material, "_METALLICSPECGLOSSMAP", mask != null);
			GameBridgeShaderValues.Keyword(material, "_OCCLUSIONMAP", mask != null);

			// With a mask these scale what the mask holds; without one they are the values themselves.
			material.SetFloat("_Metallic", mask != null ? 1f : spec.metallic);
			material.SetFloat("_Smoothness", mask != null ? 1f : 1f - spec.roughness);
		}

		private static void ApplyEmission(Material material, GameBridgeMaterialSpec spec, Texture2D emission)
		{
			material.SetTexture("_EmissionMap", emission);
			material.SetColor("_EmissionColor", emission != null ? Color.white * spec.emission : Color.black);
			GameBridgeShaderValues.Keyword(material, "_EMISSION", emission != null);
			material.globalIlluminationFlags = emission != null
				? MaterialGlobalIlluminationFlags.BakedEmissive
				: MaterialGlobalIlluminationFlags.EmissiveIsBlack;
		}

		private static void ApplyBlend(Material material, GameBridgeMaterialSpec spec)
		{
			var clip = spec.blend == "masked";
			material.SetFloat("_AlphaClip", clip ? 1f : 0f);
			material.SetFloat("_Cutoff", spec.cutoff);
			GameBridgeShaderValues.Keyword(material, "_ALPHATEST_ON", clip);

			if (!GameBridgeShaderValues.Transparent(spec))
			{
				material.SetFloat("_Surface", 0f);
				material.SetFloat("_SrcBlend", (float)BlendMode.One);
				material.SetFloat("_DstBlend", (float)BlendMode.Zero);
				material.SetFloat("_ZWrite", 1f);
				material.SetOverrideTag("RenderType", clip ? "TransparentCutout" : "Opaque");
				GameBridgeShaderValues.Keyword(material, "_SURFACE_TYPE_TRANSPARENT", false);
				material.renderQueue = clip ? (int)RenderQueue.AlphaTest : (int)RenderQueue.Geometry;
				return;
			}

			var additive = spec.blend == "additive";
			material.SetFloat("_Surface", 1f);
			material.SetFloat("_Blend", additive ? 2f : 0f);
			material.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
			material.SetFloat("_DstBlend", additive ? (float)BlendMode.One : (float)BlendMode.OneMinusSrcAlpha);
			material.SetFloat("_ZWrite", 0f);
			material.SetOverrideTag("RenderType", "Transparent");
			GameBridgeShaderValues.Keyword(material, "_SURFACE_TYPE_TRANSPARENT", true);
			material.renderQueue = (int)RenderQueue.Transparent;
		}
	}
}
