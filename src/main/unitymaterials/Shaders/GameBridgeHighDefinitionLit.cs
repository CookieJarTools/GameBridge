using System;
using System.Reflection;
using UnityEngine;

namespace GameBridgeGenerated.Materials
{
	/// <summary>
	/// Fills in HDRP's Lit shader, then asks HDRP to set its own keywords and passes. That call is
	/// made through reflection so this file compiles in projects without HDRP.
	/// </summary>
	public static class GameBridgeHighDefinitionLit
	{
		private const string ResetKeywordsType =
			"UnityEditor.Rendering.HighDefinition.HDShaderUtils, Unity.RenderPipelines.HighDefinition.Editor";

		public static void Apply(Material material, GameBridgeMaterialSpec spec, GameBridgeMaterialTextures textures)
		{
			material.SetTexture("_BaseColorMap", textures.BaseMap);
			material.SetColor("_BaseColor", GameBridgeShaderValues.Tint(spec));
			material.SetTexture("_NormalMap", textures.NormalMap);

			var mask = textures.MaskMap;
			material.SetTexture("_MaskMap", mask);
			material.SetFloat("_Metallic", mask != null ? 1f : spec.metallic);
			material.SetFloat("_Smoothness", 1f - spec.roughness);
			material.SetFloat("_MetallicRemapMax", 1f);
			material.SetFloat("_SmoothnessRemapMax", 1f);
			material.SetFloat("_AORemapMax", 1f);

			var emission = textures.EmissionMap;
			material.SetTexture("_EmissiveColorMap", emission);
			material.SetColor("_EmissiveColor", emission != null ? Color.white * spec.emission : Color.black);

			material.SetFloat("_AlphaCutoffEnable", spec.blend == "masked" ? 1f : 0f);
			material.SetFloat("_AlphaCutoff", spec.cutoff);
			material.SetFloat("_SurfaceType", GameBridgeShaderValues.Transparent(spec) ? 1f : 0f);
			material.SetFloat("_DoubleSidedEnable", spec.twoSided ? 1f : 0f);

			ResetKeywords(material);
		}

		private static void ResetKeywords(Material material)
		{
			var type = Type.GetType(ResetKeywordsType);
			var method = type?.GetMethod("ResetMaterialKeywords", BindingFlags.Public | BindingFlags.Static);
			if (method == null)
			{
				Debug.LogWarning("GameBridge could not reach HDRP to finish " + material.name + ". Selecting it in the inspector once will finish it.");
				return;
			}

			method.Invoke(null, new object[] { material });
		}
	}
}
